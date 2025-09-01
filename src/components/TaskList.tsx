import React, { useState, useMemo } from 'react';
import { BookOpen, Edit, Trash2, CheckCircle2, X, Info, ChevronDown, ChevronUp, ArrowUpDown, ArrowUp, ArrowDown, HelpCircle } from 'lucide-react';
import { Task, UserSettings } from '../types';
import { formatTime, calculateSessionDistribution } from '../utils/scheduling';

interface TaskListProps {
  tasks: Task[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onDeleteTask: (taskId: string) => void;
  autoRemovedTasks?: string[];
  onDismissAutoRemovedTask?: (taskTitle: string) => void;
  userSettings: UserSettings;
}

type EditFormData = Partial<Task> & {
  estimatedMinutes?: number;
  customCategory?: string;
  impact?: string;
  deadlineType?: 'hard' | 'soft' | 'none';
  schedulingPreference?: 'consistent' | 'opportunistic' | 'intensive';
  preferredTimeSlots?: ('morning' | 'afternoon' | 'evening')[];
  maxSessionLength?: number;
  isOneTimeTask?: boolean;
};

const TaskList: React.FC<TaskListProps> = ({ tasks, onUpdateTask, onDeleteTask, autoRemovedTasks = [], onDismissAutoRemovedTask, userSettings }) => {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<EditFormData>({});
  const [showCompletedTasks, setShowCompletedTasks] = useState(false);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showTimeEstimationModal, setShowTimeEstimationModal] = useState(false);
  // Session-based estimation state for edit form
  const [estimationMode, setEstimationMode] = useState<'total' | 'session'>('total');
  const [sessionData, setSessionData] = useState({
    sessionHours: '2',
    sessionMinutes: '0'
  });

  // Sorting state with localStorage persistence
  const [sortBy, setSortBy] = useState<'deadline' | 'startDate' | 'createdAt'>(() => {
    const saved = localStorage.getItem('timepilot-task-sort-by');
    return (saved as 'deadline' | 'startDate' | 'createdAt') || 'deadline';
  });
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    const saved = localStorage.getItem('timepilot-task-sort-order');
    return (saved as 'asc' | 'desc') || 'asc';
  });

  // Persist sorting preferences
  React.useEffect(() => {
    localStorage.setItem('timepilot-task-sort-by', sortBy);
  }, [sortBy]);

  React.useEffect(() => {
    localStorage.setItem('timepilot-task-sort-order', sortOrder);
  }, [sortOrder]);

  // Auto-detect deadline type based on whether deadline is set (similar to TaskInput)
  React.useEffect(() => {
    if (editingTaskId) {
      if (editFormData.deadline && editFormData.deadline.trim() !== '') {
        // User set a deadline - keep current deadlineType or default to 'hard'
        if (editFormData.deadlineType === 'none') {
          setEditFormData(prev => ({ ...prev, deadlineType: 'hard' }));
        }
      } else {
        // No deadline set - automatically set to 'none'
        setEditFormData(prev => ({ ...prev, deadlineType: 'none' }));
      }
    }
  }, [editFormData.deadline, editingTaskId]);

  // Get today's date in YYYY-MM-DD format for min attribute
  const today = new Date().toISOString().split('T')[0];

  // Calculate session-based total time and metadata (similar to TaskInput)
  const calculateSessionBasedTime = () => {
    if (!editFormData.startDate || !editFormData.deadline || estimationMode !== 'session') {
      return { totalTime: 0, sessions: 0, frequency: '', feasible: true, warning: '' };
    }

    const startDate = new Date(editFormData.startDate);
    const endDate = new Date(editFormData.deadline);
    const timeDiff = endDate.getTime() - startDate.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

    if (daysDiff <= 0) {
      return { totalTime: 0, sessions: 0, frequency: 'Invalid date range', feasible: false, warning: 'Deadline must be after start date' };
    }

    const sessionDuration = (parseInt(sessionData.sessionHours) || 0) + (parseInt(sessionData.sessionMinutes) || 0) / 60;
    if (sessionDuration <= 0) {
      return { totalTime: 0, sessions: 0, frequency: '', feasible: true, warning: '' };
    }

    // Calculate work days in the range
    let workDaysInRange = 0;
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      if (userSettings.workDays.includes(dayOfWeek)) {
        workDaysInRange++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (workDaysInRange === 0) {
      return { totalTime: 0, sessions: 0, frequency: 'No work days', feasible: false, warning: 'No work days in the selected range' };
    }

    // Calculate sessions - default to daily
    const numberOfSessions = workDaysInRange;
    const frequency = 'Daily';

    const totalTime = sessionDuration * numberOfSessions;

    // Check feasibility
    const dailyCapacity = userSettings.dailyAvailableHours;
    const totalCapacity = workDaysInRange * dailyCapacity;
    let feasible = true;
    let warning = '';

    if (sessionDuration > dailyCapacity) {
      feasible = false;
      warning = `Session duration (${sessionDuration.toFixed(1)}h) exceeds daily capacity (${dailyCapacity}h)`;
    } else if (totalTime > totalCapacity * 0.8) {
      feasible = false;
      warning = `Total time (${totalTime.toFixed(1)}h) may exceed available capacity`;
    }

    return { totalTime, sessions: numberOfSessions, frequency, feasible, warning };
  };

  // Auto-update total time fields when session inputs change in session mode
  React.useEffect(() => {
    if (estimationMode === 'session') {
      const calculation = calculateSessionBasedTime();
      if (calculation.totalTime > 0) {
        const hours = Math.floor(calculation.totalTime);
        const minutes = Math.round((calculation.totalTime - hours) * 60);
        setEditFormData(prev => ({
          ...prev,
          estimatedHours: hours,
          estimatedMinutes: minutes
        }));
      }
    }
  }, [sessionData.sessionHours, sessionData.sessionMinutes, editFormData.startDate, editFormData.deadline, estimationMode, userSettings.workDays]);

  // Sorting function
  const sortTasks = (tasksToSort: Task[]) => {
    return [...tasksToSort].sort((a, b) => {
      let aValue: string | Date;
      let bValue: string | Date;

      switch (sortBy) {
        case 'deadline':
          // Tasks without deadline go to end when sorting ascending, beginning when descending
          aValue = a.deadline ? new Date(a.deadline) : (sortOrder === 'asc' ? new Date('9999-12-31') : new Date('1970-01-01'));
          bValue = b.deadline ? new Date(b.deadline) : (sortOrder === 'asc' ? new Date('9999-12-31') : new Date('1970-01-01'));
          break;
        case 'startDate':
          aValue = a.startDate ? new Date(a.startDate) : new Date(a.createdAt);
          bValue = b.startDate ? new Date(b.startDate) : new Date(b.createdAt);
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt);
          bValue = new Date(b.createdAt);
          break;
        default:
          return 0;
      }

      const comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  };

  // Separate active and completed tasks with sorting
  const activeTasks = sortTasks(tasks.filter(task => task.status === 'pending'));
  const completedTasks = sortTasks(tasks.filter(task => task.status === 'completed'));

  // Check if current edit form represents a low-priority urgent task
  const isLowPriorityUrgent = React.useMemo(() => {
    if (!editFormData.deadline) return false;
    const deadline = new Date(editFormData.deadline);
    const now = new Date();
    const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilDeadline <= 3 && editFormData.importance === false;
  }, [editFormData.deadline, editFormData.importance]);

  // No frequency restrictions needed - using session-based estimation



  // Get effective total time from direct input
  const getEffectiveTotalTime = () => {
    return (editFormData.estimatedHours || 0) + ((editFormData.estimatedMinutes || 0) / 60);
  };

  // Validation error messages
  const getValidationErrors = (): string[] => {
    const errors: string[] = [];
    if (!editFormData.title?.trim()) errors.push('Task title is required');
    if (editFormData.title && editFormData.title.trim().length > 100) errors.push('Task title must be 100 characters or less');

    const totalHours = getEffectiveTotalTime();
    if (totalHours <= 0) errors.push('Estimated time must be greater than 0');
    if (totalHours > 100) errors.push('Estimated time seems unreasonably high (over 100 hours)');

    if (!editFormData.impact) errors.push('Please select task importance');
    if (editFormData.deadline && editFormData.deadline < today) errors.push('Deadline cannot be in the past');
    // Start date validation removed for editing tasks - tasks are already created

    if (editFormData.category === 'Custom...' && (!editFormData.customCategory?.trim() || editFormData.customCategory.trim().length > 50)) {
      errors.push('Custom category must be between 1-50 characters');
    }

    if (editFormData.isOneTimeTask) {
      if (!editFormData.deadline || editFormData.deadline.trim() === '') errors.push('One-sitting tasks require a deadline');
      if (totalHours > userSettings.dailyAvailableHours) errors.push(`One-sitting task (${totalHours}h) exceeds your daily available hours (${userSettings.dailyAvailableHours}h)`);
    }

    return errors;
  };

  // Check if deadline is in the past
  const isDeadlinePast = editFormData.deadline ? editFormData.deadline < today : false;
  // Start date validation removed for editing tasks

  // Check for deadline conflict with frequency preference
  const deadlineConflict = useMemo(() => {
    if (!editFormData.deadline || editFormData.deadlineType === 'none') {
      return { hasConflict: false };
    }

    const totalHours = getEffectiveTotalTime();
    const taskForCheck = {
      deadline: editFormData.deadline,
      estimatedHours: totalHours,
      deadlineType: editFormData.deadlineType,
      startDate: editFormData.startDate
    };

    return calculateSessionDistribution(taskForCheck, userSettings);
  }, [editFormData.deadline, editFormData.estimatedHours, editFormData.estimatedMinutes, editFormData.deadlineType, editFormData.startDate, userSettings]);

  const getUrgencyColor = (deadline: string): string => {
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const daysUntilDeadline = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilDeadline <= 1) return 'text-red-600';
    if (daysUntilDeadline <= 3) return 'text-orange-600';
    if (daysUntilDeadline <= 7) return 'text-yellow-600';
    return 'text-green-600';
  };

  // Get category color based on calendar view color scheme
  const getCategoryColor = (category?: string): string => {
    if (!category) return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    
    switch (category.toLowerCase()) {
      case 'academics':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'personal':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'learning':
        return 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200';
      case 'home':
        return 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200';
      case 'finance':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'org':
      case 'organization':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'work':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'health':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  const startEditing = (task: Task) => {
    setEditingTaskId(task.id);
    const totalMinutes = Math.round((task.estimatedHours || 0) * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;


    setEditFormData({
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      importance: task.importance,
      estimatedHours: hours,
      estimatedMinutes: minutes,
      subject: task.subject,
      category: task.category === 'Custom...' ? '' : task.category,
      customCategory: task.category && !['Academics', 'Organization', 'Work', 'Personal', 'Health', 'Learning', 'Finance', 'Home', 'Routine'].includes(task.category) ? task.category : '',
      impact: task.impact || (task.importance ? 'high' : 'low'),
      deadlineType: task.deadlineType || (task.deadline ? 'hard' : 'none'),
      schedulingPreference: task.schedulingPreference || 'consistent',
      preferredTimeSlots: task.preferredTimeSlots || [],
      maxSessionLength: task.maxSessionLength || 2,
      isOneTimeTask: task.isOneTimeTask || false,
      startDate: task.startDate || today,
    });
    setShowAdvancedOptions(false);
  };

  // Enhanced form validation for edit form with TaskInput restrictions
  const isEditFormValid = React.useMemo(() => {
    if (!editFormData.title?.trim()) return false;
    if (editFormData.title && editFormData.title.trim().length > 100) return false; // Title length limit

    const totalHours = getEffectiveTotalTime();
    if (totalHours <= 0) return false;
    if (totalHours > 100) return false; // Reasonable hour limit

    if (!editFormData.impact) return false;
    if (editFormData.deadline && editFormData.deadline < today) return false;
    // Start date validation removed for editing tasks - tasks are already created

    // Custom category validation (1-50 characters)
    if (editFormData.category === 'Custom...' && (!editFormData.customCategory?.trim() || editFormData.customCategory.trim().length > 50)) return false;

    // One-sitting task validation
    if (editFormData.isOneTimeTask) {
      if (!editFormData.deadline || editFormData.deadline.trim() === '') return false; // One-sitting requires deadline
      if (totalHours > userSettings.dailyAvailableHours) return false; // Can't exceed daily hours
    }

    return true;
  }, [editFormData, today, userSettings]);

  const saveEdit = () => {
    if (editingTaskId && isEditFormValid) {
      const totalHours = getEffectiveTotalTime();
      const category = editFormData.category === 'Custom...' ? editFormData.customCategory : editFormData.category;

      onUpdateTask(editingTaskId, {
        ...editFormData,
        estimatedHours: totalHours,
        category,
        deadline: editFormData.deadlineType === 'none' ? '' : (editFormData.deadline || ''),
        deadlineType: editFormData.deadline ? editFormData.deadlineType : 'none',
        importance: editFormData.impact === 'high',
        // Ensure all advanced fields are properly updated
        preferredTimeSlots: editFormData.preferredTimeSlots,
        maxSessionLength: editFormData.maxSessionLength,
        isOneTimeTask: editFormData.isOneTimeTask,
        schedulingPreference: editFormData.schedulingPreference,
        startDate: editFormData.startDate || today,
      });
      setEditingTaskId(null);
      setEditFormData({});
      setShowAdvancedOptions(false);
    }
  };

  const cancelEdit = () => {
    setEditingTaskId(null);
    setEditFormData({});
    setShowAdvancedOptions(false);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Auto-removed tasks notifications */}
      {autoRemovedTasks.map((title) => (
            <div key={title} className="flex items-center bg-red-100 text-red-800 px-4 py-2 rounded shadow border-l-4 border-red-500">
          <Info className="w-4 h-4 mr-2 flex-shrink-0" />
          <span className="text-sm flex-1">
            Task "{title}" was automatically removed due to missed deadline.
          </span>
            <button
            onClick={() => onDismissAutoRemovedTask?.(title)}
            className="ml-2 text-red-600 hover:text-red-800"
            >
            <X className="w-4 h-4" />
            </button>
        </div>
      ))}
      
      {/* Active Tasks */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
          <div className="flex items-center space-x-2">
            <BookOpen className="text-blue-600 dark:text-blue-400" size={20} />
            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-white">Active Tasks</h2>
            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full dark:bg-blue-900 dark:text-blue-200">
              {activeTasks.length}
            </span>
          </div>

          {/* Sorting Controls */}
          {activeTasks.length > 0 && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'deadline' | 'startDate' | 'createdAt')}
                className="text-sm border border-gray-300 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600 focus:ring-2 focus:ring-blue-500"
                title="Choose how to sort tasks"
              >
                <option value="deadline">Deadline</option>
                <option value="startDate">Start Date</option>
                <option value="createdAt">Date Created</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                title={`Currently sorting ${sortOrder === 'asc' ? 'earliest to latest' : 'latest to earliest'}. Click to reverse order.`}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUp size={16} className="text-gray-600 dark:text-gray-400" />
                ) : (
                  <ArrowDown size={16} className="text-gray-600 dark:text-gray-400" />
                )}
              </button>
            </div>
          )}
        </div>

        {activeTasks.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-4"></div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">No Active Tasks</h3>
            <p className="text-gray-600 dark:text-gray-300">Add your first task to get started!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeTasks.map((task) => (
              <div
                key={task.id}
                className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 hover:shadow-md transition-all duration-200 dark:bg-gray-800 dark:border-gray-700"
              >
              {editingTaskId === task.id ? (
                  <div className="space-y-4">
                    {/* 1. Task Title */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Task Title <span className="text-red-500">*</span></label>
                      <input
                        type="text"
                        required
                        value={editFormData.title || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                        className="w-full px-4 py-3 backdrop-blur-sm bg-white/70 dark:bg-black/20 border border-white/30 dark:border-white/20 rounded-xl text-base focus:ring-2 focus:ring-violet-500 focus:border-transparent dark:text-white transition-all duration-300"
                        placeholder="e.g., Write project report"
                      />
                    </div>

                    {/* 2. Description */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Description <span className="text-gray-400">(Optional)</span></label>
                      <textarea
                        value={editFormData.description || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none h-20 border-gray-300 bg-white dark:bg-gray-800 dark:text-white"
                        placeholder="Describe the task..."
                      />
                    </div>

                    {/* 3. Category */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Category <span className="text-gray-400">(Optional)</span></label>
                      <select
                        value={editFormData.category || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value, customCategory: '' })}
                        className="w-full border rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 dark:text-white"
                      >
                        <option value="">Select category...</option>
                        {['Academics', 'Organization', 'Work', 'Personal', 'Health', 'Learning', 'Finance', 'Home', 'Routine', 'Custom...'].map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      {editFormData.category === 'Custom...' && (
                        <input
                          type="text"
                          value={editFormData.customCategory || ''}
                          onChange={(e) => setEditFormData({ ...editFormData, customCategory: e.target.value })}
                          className="w-full border rounded-lg px-3 py-2 mt-2 text-base bg-white dark:bg-gray-800 dark:text-white"
                          placeholder="Enter custom category"
                        />
                      )}
                    </div>

                    {/* 4. Deadline (with Start Date to the right) */}
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Deadline <span className="text-gray-400">(Optional)</span></label>
                          <input
                            type="date"
                            min={today}
                            value={editFormData.deadline || ''}
                            onChange={(e) => setEditFormData({ ...editFormData, deadline: e.target.value })}
                            className="w-full px-3 py-2 border rounded-lg text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent border-gray-300 bg-white dark:bg-gray-800 dark:text-white"
                            placeholder="Select deadline (optional)"
                          />
                          {isDeadlinePast && editFormData.deadline && (
                            <div className="text-red-600 text-xs mt-1">Deadline cannot be in the past.</div>
                          )}
                        </div>

                        {!editFormData.isOneTimeTask && (
                          <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Start Date</label>
                            <input
                              type="date"
                              min={today}
                              value={editFormData.startDate || ''}
                              onChange={(e) => setEditFormData({ ...editFormData, startDate: e.target.value || today })}
                              className="w-full px-3 py-2 border rounded-lg text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent border-gray-300 bg-white dark:bg-gray-800 dark:text-white"
                            />
                            {/* Start date validation warning removed for editing tasks */}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Leave deadline empty for flexible tasks, or set a deadline for time-sensitive work</div>
                    </div>

                    {/* 5. One sitting toggle */}
                    <div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editFormData.isOneTimeTask || false}
                          onChange={(e) => setEditFormData({ ...editFormData, isOneTimeTask: e.target.checked })}
                          className="text-blue-600"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-200">Complete this task in one sitting (don't divide into sessions)</span>
                      </label>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Check this for short tasks or tasks that need to be done all at once</div>
                      {editFormData.isOneTimeTask && (
                        <div className="mt-1 p-2 bg-blue-50 dark:bg-blue-900/20 rounded border-l-2 border-blue-300 dark:border-blue-600">
                          <div className="text-xs text-blue-700 dark:text-blue-300">
                             One-sitting tasks will be scheduled as single blocks. Work frequency settings won't apply.
                          </div>
                        </div>
                      )}
                    </div>


                    {/* 7. Time Estimation - Dual Mode Interface */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                            Time Estimation <span className="text-red-500">*</span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setShowTimeEstimationModal(true)}
                            className="text-gray-400 hover:text-blue-600 transition-colors"
                            title="How does time estimation work?"
                          >
                            <HelpCircle size={14} />
                          </button>
                        </div>
                        <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                          <button
                            type="button"
                            onClick={() => setEstimationMode('total')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                              estimationMode === 'total'
                                ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                            }`}
                          >
                            Total Time
                          </button>
                          <button
                            type="button"
                            onClick={() => setEstimationMode('session')}
                            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                              estimationMode === 'session'
                                ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                            }`}
                          >
                            Session Planning
                          </button>
                        </div>
                      </div>

                      {estimationMode === 'total' ? (
                        <div className="flex gap-2 items-center">
                          <div className="flex-1">
                            <input
                              type="number"
                              min="0"
                              value={editFormData.estimatedHours || ''}
                              onChange={(e) => {
                                const value = parseInt(e.target.value) || 0;
                                if (value >= 0) {
                                  setEditFormData({ ...editFormData, estimatedHours: value });
                                }
                              }}
                              className="w-full border rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent border-gray-300 bg-white dark:bg-gray-800 dark:text-white"
                              placeholder="0"
                            />
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Hours</div>
                          </div>
                          <div className="text-gray-500 dark:text-gray-400 text-lg font-bold">:</div>
                          <div className="flex-1">
                            <input
                              type="number"
                              min="0"
                              max="59"
                              value={editFormData.estimatedMinutes || ''}
                              onChange={(e) => {
                                const value = parseInt(e.target.value) || 0;
                                if (value >= 0 && value <= 59) {
                                  setEditFormData({ ...editFormData, estimatedMinutes: value });
                                }
                              }}
                              className="w-full border rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent border-gray-300 bg-white dark:bg-gray-800 dark:text-white"
                              placeholder="0"
                            />
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minutes</div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                          <div className="flex items-center space-x-2 text-blue-700 dark:text-blue-300">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-medium text-sm">Session-Based Planning</span>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
                              How long will each work session be?
                            </label>
                            <div className="flex gap-2 items-center">
                              <div className="flex-1">
                                <input
                                  type="number"
                                  min="0"
                                  max="8"
                                  value={sessionData.sessionHours}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === '' || (/^\d*$/.test(value) && parseInt(value) >= 0 && parseInt(value) <= 8)) {
                                      setSessionData(prev => ({ ...prev, sessionHours: value }));
                                    }
                                  }}
                                  className="w-full border rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent border-gray-300 bg-white dark:bg-gray-800 dark:text-white"
                                  placeholder="2"
                                />
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Hours</div>
                              </div>
                              <div className="text-gray-500 dark:text-gray-400 text-lg font-bold">:</div>
                              <div className="flex-1">
                                <input
                                  type="number"
                                  min="0"
                                  max="59"
                                  value={sessionData.sessionMinutes}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === '' || /^\d*$/.test(value)) {
                                      const numValue = parseInt(value) || 0;
                                      if (numValue >= 0 && numValue <= 59) {
                                        setSessionData(prev => ({ ...prev, sessionMinutes: value }));
                                      }
                                    }
                                  }}
                                  className="w-full border rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-blue-500 focus:border-transparent border-gray-300 bg-white dark:bg-gray-800 dark:text-white"
                                  placeholder="0"
                                />
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minutes</div>
                              </div>
                            </div>
                          </div>

                          {editFormData.startDate && editFormData.deadline && (() => {
                            const calculation = calculateSessionBasedTime();
                            return (
                              <div className={`p-3 rounded-lg border ${
                                calculation.feasible
                                  ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600'
                                  : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
                              }`}>
                                <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Automatic Calculation:</div>
                                <div className="grid grid-cols-3 gap-3 text-sm">
                                  <div>
                                    <div className="text-gray-500 dark:text-gray-400">Session Duration:</div>
                                    <div className="font-medium text-gray-800 dark:text-white">
                                      {sessionData.sessionHours}h {sessionData.sessionMinutes}m
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-gray-500 dark:text-gray-400">Planned Sessions:</div>
                                    <div className="font-medium text-gray-800 dark:text-white">
                                      {calculation.sessions} sessions
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-gray-500 dark:text-gray-400">Total Time:</div>
                                    <div className={`font-medium ${
                                      calculation.feasible
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-red-600 dark:text-red-400'
                                    }`}>
                                      {calculation.totalTime > 0 ? `${calculation.totalTime.toFixed(1)}h` : 'Set session duration'}
                                    </div>
                                  </div>
                                </div>

                                {calculation.frequency && (
                                  <div className="mt-2 flex items-center space-x-1">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Frequency:</span>
                                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{calculation.frequency}</span>
                                  </div>
                                )}

                                {calculation.warning && (
                                  <div className="mt-2 flex items-start space-x-2 text-xs text-red-600 dark:text-red-400">
                                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>{calculation.warning}</span>
                                  </div>
                                )}

                                {calculation.feasible && calculation.totalTime > 0 && (
                                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                                    The app will automatically schedule {calculation.sessions} sessions based on your availability.
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {(!editFormData.startDate || !editFormData.deadline) && (
                            <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg flex items-center space-x-2">
                              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>Please set both start date and deadline to see the automatic calculation.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* 8. Task Importance */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">How much will this impact your goals? <span className="text-red-500">*</span></label>
                      <div className="flex flex-col md:flex-row gap-4 mt-2">
                        <label className="flex items-center gap-2 text-base font-normal text-gray-700 dark:text-gray-100">
                          <input
                            type="radio"
                            name="impact"
                            value="high"
                            checked={editFormData.impact === 'high'}
                            onChange={() => setEditFormData({ ...editFormData, impact: 'high' })}
                          />
                          <span>High impact (significantly affects your success/commitments)</span>
                        </label>
                        <label className="flex items-center gap-2 text-base font-normal text-gray-700 dark:text-gray-100">
                          <input
                            type="radio"
                            name="impact"
                            value="low"
                            checked={editFormData.impact === 'low'}
                            onChange={() => setEditFormData({ ...editFormData, impact: 'low' })}
                          />
                          <span>Low impact (standard task, manageable if delayed)</span>
                        </label>
                      </div>
                    </div>

                    {/* Advanced Timeline Options Toggle */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                        className="flex items-center gap-2 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium transition-colors"
                      >
                        {showAdvancedOptions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        Advanced Timeline Options
                      </button>

                      {showAdvancedOptions && (
                        <div className="mt-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
                          <div className="mb-3">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Task Timeline Options</span>
                          </div>



                          {/* Additional preferences for no-deadline tasks */}
                          {editFormData.deadlineType === 'none' && (
                            <div className="space-y-3 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-700">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
                                  Maximum session length
                                  <span className="text-gray-500 text-xs ml-1">(for tasks with no deadline but distributed into sessions)</span>
                                </label>
                                <select
                                  value={editFormData.maxSessionLength || 2}
                                  onChange={(e) => {
                                    const value = parseFloat(e.target.value);
                                    if (value > 0) {
                                      setEditFormData({ ...editFormData, maxSessionLength: value });
                                    }
                                  }}
                                  className="w-full px-2 py-1 border rounded text-sm bg-white dark:bg-gray-800 dark:text-white"
                                >
                                  <option value={1}>1 hour</option>
                                  <option value={1.5}>1.5 hours</option>
                                  <option value={2}>2 hours</option>
                                  <option value={3}>3 hours</option>
                                  <option value={4}>4 hours</option>
                                </select>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Warning for low-priority urgent tasks */}
                    {isLowPriorityUrgent && (
                      <div className="flex items-center space-x-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-900/20 dark:border-yellow-800">
                        <Info className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
                        <span className="text-sm text-yellow-700 dark:text-yellow-300">
                          This task is due soon but marked as low priority. Consider increasing the priority.
                        </span>
                      </div>
                    )}

                    {/* Warning for past deadline */}
                    {isDeadlinePast && (
                      <div className="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg dark:bg-red-900/20 dark:border-red-800">
                        <Info className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                        <span className="text-sm text-red-700 dark:text-red-300">
                          This deadline is in the past. Please update it to a future date.
                        </span>
                      </div>
                    )}

                    {/* Enhanced validation errors display */}
                    {!isEditFormValid && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2 dark:bg-red-900/20 dark:border-red-700">
                        <div className="text-red-800 dark:text-red-200 font-medium mb-2">Please fix these issues:</div>
                        <ul className="text-red-700 dark:text-red-300 text-sm space-y-1">
                          {getValidationErrors().map((error, index) => (
                            <li key={index} className="flex items-start gap-2">
                              <span className="text-red-500 mt-0.5">•</span>
                              <span>{error}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Frequency restriction warnings */}
                    {false && (
                      <div className="mt-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg">
                        <div className="flex items-start gap-2">
                          <span className="text-orange-500 text-sm">⚠️</span>
                          <div className="text-xs text-orange-700 dark:text-orange-200">
                            <div className="font-medium mb-1">Frequency Options Limited</div>
                            {frequencyRestrictions.disableWeekly && (
                              <div className="mb-1">• Weekly sessions need at least 2 weeks between start date and deadline</div>
                            )}
                            {frequencyRestrictions.disable3xWeek && (
                              <div className="mb-1">• 2-3 days frequency needs at least 1 week between start date and deadline</div>
                            )}
                            <div className="text-orange-600 dark:text-orange-300 font-medium">Consider extending your deadline or using daily progress instead.</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Deadline conflict warning */}
                    {deadlineConflict.hasConflict && (
                      <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded text-xs text-amber-700 dark:text-amber-200">
                        <div className="font-medium">Frequency preference may not allow completion before deadline</div>
                        {deadlineConflict.reason && (
                          <div className="mt-1">{deadlineConflict.reason}</div>
                        )}
                        {deadlineConflict.recommendedFrequency && (
                          <div className="mt-1">
                            <strong>Recommended:</strong> Switch to "{deadlineConflict.recommendedFrequency}" frequency, or daily scheduling will be used instead.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Low-priority urgent warning */}
                    {isLowPriorityUrgent && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-2 dark:bg-yellow-900/20 dark:border-yellow-700">
                        <div className="text-yellow-800 dark:text-yellow-200 font-medium mb-1">Warning: low priority with urgent deadline</div>
                        <div className="text-yellow-700 dark:text-yellow-300 text-sm">
                          This task is low priority but has an urgent deadline. It may not be scheduled if you have more important urgent tasks.
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
                      <button
                        onClick={saveEdit}
                        disabled={!isEditFormValid}
                        className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                          isEditFormValid
                            ? 'bg-blue-500 text-white hover:bg-blue-600'
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-600 dark:text-gray-400'
                        }`}
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
              ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-white truncate">
                          {task.title}
                        </h3>
                        {task.importance && (
                            <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full dark:bg-red-900 dark:text-red-200 flex-shrink-0">
                            Important
                          </span>
                        )}
                        </div>
                        
                        <div className="space-y-2">
                        {task.subject && (
                            <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                              <span className="font-medium"></span>
                              <span className="truncate">{task.subject}</span>
                            </div>
                          )}
                          
                          <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                            <span className="font-medium"></span>
                            <span>{formatTime(task.estimatedHours)}</span>
                          </div>
                          
                          {task.deadline && (
                            <div className="flex items-center space-x-2 text-sm">
                              <span className="font-medium"></span>
                              <span className={`${getUrgencyColor(task.deadline)}`}>
                                Due: {new Date(task.deadline).toLocaleDateString()}
                            </span>
                            </div>
                          )}
                          
                        {task.category && (
                            <div className="flex items-center space-x-2">
                              <span className={`text-xs px-2 py-1 rounded-full ${getCategoryColor(task.category)}`}>
                            {task.category}
                          </span>
                            </div>
                          )}
                          
                        {task.description && (
                            <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                            {task.description}
                          </p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2 ml-3 flex-shrink-0">
                      <button
                        onClick={() => onUpdateTask(task.id, { status: 'completed' })}
                        className="p-2 text-green-500 hover:text-green-700 hover:bg-green-100 rounded-lg transition-colors dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-900"
                        title="Mark as completed"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                        <button
                          onClick={() => startEditing(task)}
                          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700"
                          title="Edit task"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-lg transition-colors dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900"
                          title="Delete task"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
              )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="text-green-600 dark:text-green-400" size={20} />
                <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-white">Completed Tasks</h2>
                <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full dark:bg-green-900 dark:text-green-200">
                  {completedTasks.length}
                </span>
              </div>
              <button
                onClick={() => setShowCompletedTasks(!showCompletedTasks)}
                className="text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {showCompletedTasks ? 'Hide' : 'Show'} Completed
              </button>
            </div>

            {/* Sorting Controls for Completed Tasks */}
            {showCompletedTasks && completedTasks.length > 0 && (
              <div className="flex items-center space-x-2 ml-7">
                <span className="text-sm text-gray-600 dark:text-gray-400">Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'deadline' | 'startDate' | 'createdAt')}
                  className="text-sm border border-gray-300 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 dark:text-white dark:border-gray-600 focus:ring-2 focus:ring-blue-500"
                  title="Choose how to sort completed tasks"
                >
                  <option value="deadline">Deadline</option>
                  <option value="startDate">Start Date</option>
                  <option value="createdAt">Date Created</option>
                </select>
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600"
                  title={`Currently sorting ${sortOrder === 'asc' ? 'earliest to latest' : 'latest to earliest'}. Click to reverse order.`}
                >
                  {sortOrder === 'asc' ? (
                    <ArrowUp size={16} className="text-gray-600 dark:text-gray-400" />
                  ) : (
                    <ArrowDown size={16} className="text-gray-600 dark:text-gray-400" />
                  )}
                </button>
              </div>
            )}
          </div>

          {showCompletedTasks && (
          <div className="space-y-3">
            {completedTasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-gray-50 border border-gray-200 rounded-xl p-4 sm:p-6 dark:bg-gray-800 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-2">
                        <h3 className="text-base sm:text-lg font-semibold text-gray-600 dark:text-gray-300 truncate line-through">
                        {task.title}
                      </h3>
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full dark:bg-green-900 dark:text-green-200">
                          Completed
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                      {task.subject && (
                          <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                            <span className="font-medium"></span>
                            <span className="truncate">{task.subject}</span>
                          </div>
                        )}
                        
                        <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                          <span className="font-medium"></span>
                          <span>{formatTime(task.estimatedHours)}</span>
                        </div>
                        
                        {task.deadline && (
                          <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                            <span className="font-medium"></span>
                            <span>Due: {new Date(task.deadline).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 ml-3 flex-shrink-0">
                    <button
                      onClick={() => onDeleteTask(task.id)}
                      className="p-2 text-red-500 hover:text-red-700 hover:bg-red-100 rounded-lg transition-colors dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900"
                      title="Delete task"
                    >
                        <Trash2 size={16} />
                    </button>
                    </div>
                  </div>
                </div>
            ))}
          </div>
          )}
        </div>
      )}


      {/* Time Estimation Help Modal */}
      {showTimeEstimationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md max-h-96 overflow-y-auto m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Time Estimation Guide</h3>
              <button
                onClick={() => setShowTimeEstimationModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
              <div>
                <h4 className="font-medium text-gray-800 dark:text-white mb-2">🕒 Total Time</h4>
                <p>Estimate the complete time needed to finish the entire task. The app will automatically divide this into manageable study sessions based on your frequency preference.</p>
                <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  Example: "Write essay" = 6 hours total
                </div>
              </div>

              <div>
                <h4 className="font-medium text-gray-800 dark:text-white mb-2">📅 Session-Based</h4>
                <p>Specify how long each individual study session should be. The app calculates total time by multiplying session duration × frequency × available days until deadline.</p>
                <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  Example: 1 hour sessions × daily × 7 days = 7 hours total
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg">
                <p className="text-blue-800 dark:text-blue-200 text-xs">
                  <strong>💡 Tip:</strong> Use "Total Time" when you know exactly how much work is needed. Use "Session-Based" when you prefer consistent daily sessions and want to see the cumulative effect.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskList;
