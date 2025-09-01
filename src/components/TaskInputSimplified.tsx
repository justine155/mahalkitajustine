import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Info, HelpCircle, ChevronDown, ChevronUp, Clock, X } from 'lucide-react';
import { Task, UserSettings, StudyPlan, FixedCommitment } from '../types';
import { findNextAvailableTimeSlot, doesCommitmentApplyToDate, getEffectiveStudyWindow, calculateSessionDistribution } from '../utils/scheduling';
import TimeEstimationModal from './TimeEstimationModal';

interface TaskInputProps {
  onAddTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
  onCancel?: () => void;
  userSettings: UserSettings;
  existingStudyPlans?: StudyPlan[];
  fixedCommitments?: FixedCommitment[];
}

const TaskInputSimplified: React.FC<TaskInputProps> = ({ onAddTask, onCancel, userSettings, existingStudyPlans = [], fixedCommitments = [] }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    deadline: '',
    estimatedHours: '',
    estimatedMinutes: '0',
    category: '',
    customCategory: '',
    impact: '',
    taskType: '',
    deadlineType: 'hard' as 'hard' | 'soft' | 'none',
    schedulingPreference: 'consistent' as 'consistent' | 'opportunistic' | 'intensive',
    isOneTimeTask: false,
    startDate: new Date().toISOString().split('T')[0],
    // Simplified estimation fields
    totalTimeNeeded: '',
  });

  // Session-based estimation state
  const [estimationMode, setEstimationMode] = useState<'total' | 'session'>('total');
  const [sessionData, setSessionData] = useState({
    sessionDuration: '2.0',
    sessionHours: '2',
    sessionMinutes: '0'
  });

  const [showTimeEstimationModal, setShowTimeEstimationModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  
  // Quick time presets
  const [showTimePresets, setShowTimePresets] = useState(false);
  const timePresets = [
    { label: '15m', hours: '0', minutes: '15' },
    { label: '30m', hours: '0', minutes: '30' },
    { label: '45m', hours: '0', minutes: '45' },
    { label: '1h', hours: '1', minutes: '0' },
    { label: '1h 30m', hours: '1', minutes: '30' },
    { label: '2h', hours: '2', minutes: '0' },
    { label: '3h', hours: '3', minutes: '0' },
  ];

  // Auto-detect deadline type based on whether deadline is set
  useEffect(() => {
    if (formData.deadline && formData.deadline.trim() !== '') {
      // User set a deadline - keep current deadlineType or default to 'hard'
      if (formData.deadlineType === 'none') {
        setFormData(f => ({ ...f, deadlineType: 'hard' }));
      }
    } else {
      // No deadline set - automatically set to 'none'
      setFormData(f => ({ ...f, deadlineType: 'none' }));
    }
  }, [formData.deadline]);

  // Calculate session-based total time and metadata (same logic as TaskInput)
  const calculateSessionBasedTime = () => {
    if (!formData.startDate || !formData.deadline || estimationMode !== 'session') {
      return { totalTime: 0, sessions: 0, frequency: '', feasible: true, warning: '' };
    }

    const startDate = new Date(formData.startDate);
    const endDate = new Date(formData.deadline);
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

  // Update total time when session data changes
  useEffect(() => {
    if (estimationMode === 'session') {
      const calculation = calculateSessionBasedTime();
      if (calculation.totalTime > 0) {
        const hours = Math.floor(calculation.totalTime);
        const minutes = Math.round((calculation.totalTime - hours) * 60);
        setFormData(prev => ({
          ...prev,
          estimatedHours: hours.toString(),
          estimatedMinutes: minutes.toString()
        }));
      }
    }
  }, [sessionData.sessionHours, sessionData.sessionMinutes, formData.startDate, formData.deadline, estimationMode, userSettings.workDays]);

  // Reset conflicting options when one-sitting task is toggled
  useEffect(() => {
    if (formData.isOneTimeTask) {
      // One-sitting tasks don't need session division
    }
  }, [formData.isOneTimeTask]);

  // Validation functions
  const convertToDecimalHours = (hours: string, minutes: string): number => {
    const h = Math.max(0, parseInt(hours) || 0);
    const m = Math.max(0, Math.min(59, parseInt(minutes) || 0));
    return h + (m / 60);
  };

  const formatTimeDisplay = (hours: string, minutes: string): string => {
    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    if (h === 0 && m === 0) return '0 minutes';
    if (h === 0) return `${m} minutes`;
    if (m === 0) return `${h} hour${h !== 1 ? 's' : ''}`;
    return `${h} hour${h !== 1 ? 's' : ''} ${m} minutes`;
  };


  // Get effective total time (use totalTimeNeeded if provided, otherwise estimatedHours+Minutes)
  const getEffectiveTotalTime = () => {
    if (formData.totalTimeNeeded && parseFloat(formData.totalTimeNeeded) > 0) {
      return parseFloat(formData.totalTimeNeeded);
    }
    return convertToDecimalHours(formData.estimatedHours, formData.estimatedMinutes);
  };

  // Session distribution calculation for display
  const sessionDistribution = useMemo(() => {
    if (!formData.deadline || formData.deadlineType === 'none' || formData.isOneTimeTask) {
      return {
        suggestedFrequency: 'relaxed' as const,
        description: 'Sessions will be distributed based on available time slots',
        estimatedSessions: 0
      };
    }

    const effectiveTime = getEffectiveTotalTime();
    if (effectiveTime <= 0) {
      return {
        suggestedFrequency: 'relaxed' as const,
        description: 'Sessions will be distributed based on available time slots',
        estimatedSessions: 0
      };
    }

    // Simple description based on deadline urgency
    const startDate = new Date(formData.startDate || today);
    const deadlineDate = new Date(formData.deadline);
    const daysUntilDeadline = Math.ceil((deadlineDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilDeadline < 7) {
      return {
        suggestedFrequency: 'urgent' as const,
        description: 'Urgent deadline - daily sessions recommended',
        estimatedSessions: Math.ceil(effectiveTime / 2) // Assume 2h sessions
      };
    } else if (daysUntilDeadline < 14) {
      return {
        suggestedFrequency: 'moderate' as const,
        description: 'Moderate timeline - every other day sessions',
        estimatedSessions: Math.ceil(effectiveTime / 2)
      };
    } else {
      return {
        suggestedFrequency: 'relaxed' as const,
        description: '2-3 sessions per week recommended',
        estimatedSessions: Math.ceil(effectiveTime / 2)
      };
    }
  }, [formData.deadline, formData.deadlineType, formData.startDate, formData.isOneTimeTask, getEffectiveTotalTime(), today]);

  // Show custom category input when "Custom..." is selected
  const showCustomCategory = formData.category === 'Custom...';

  // Validation
  const totalTime = convertToDecimalHours(formData.estimatedHours, formData.estimatedMinutes);
  const estimatedDecimalHours = getEffectiveTotalTime();

  const isDeadlineValid = !formData.deadline || new Date(formData.deadline) >= new Date(today);
  const isStartDateValid = !formData.startDate || new Date(formData.startDate) >= new Date(today);

  // One-sitting task validation checks
  const isOneSittingTooLong = formData.isOneTimeTask && estimatedDecimalHours > userSettings.dailyAvailableHours;

  // Check if deadline allows for one-sitting task
  const oneSittingTimeSlotCheck = useMemo(() => {
    if (!formData.isOneTimeTask || !formData.deadline || estimatedDecimalHours <= 0) {
      return { hasSlot: true, message: '' };
    }

    const deadlineDate = formData.deadline;

    // Get existing sessions for the deadline date
    const existingSessions = existingStudyPlans
      .find(plan => plan.date === deadlineDate)
      ?.plannedTasks || [];

    // Get the effective study window for the deadline date
    const effectiveWindow = getEffectiveStudyWindow(deadlineDate, userSettings);

    const timeSlot = findNextAvailableTimeSlot(
      estimatedDecimalHours,
      existingSessions,
      fixedCommitments,
      effectiveWindow.startHour,
      effectiveWindow.endHour,
      userSettings.bufferTimeBetweenSessions || 0,
      deadlineDate,
      userSettings
    );

    if (!timeSlot) {
      return {
        hasSlot: false,
        message: 'No available time slot found for this one-sitting task on the deadline date.'
      };
    }

    return { hasSlot: true, message: '' };
  }, [formData.isOneTimeTask, formData.deadline, estimatedDecimalHours, userSettings, fixedCommitments, existingStudyPlans]);

  const isOneSittingNoTimeSlot = formData.isOneTimeTask && !oneSittingTimeSlotCheck.hasSlot;

  const isFormValid = formData.title.trim() &&
                     (totalTime > 0 || (formData.totalTimeNeeded && parseFloat(formData.totalTimeNeeded) > 0)) &&
                     formData.impact &&
                     isDeadlineValid &&
                     isStartDateValid &&
                     (!formData.isOneTimeTask || (formData.deadline && !isOneSittingTooLong && !isOneSittingNoTimeSlot));

  const getValidationErrors = () => {
    const errors: string[] = [];
    if (!formData.title.trim()) errors.push('Task title is required');
    if (totalTime <= 0 && (!formData.totalTimeNeeded || isNaN(parseFloat(formData.totalTimeNeeded)) || parseFloat(formData.totalTimeNeeded) <= 0)) {
      errors.push('Time estimation is required');
    }
    if (!formData.impact) errors.push('Task importance is required');
    if (!isDeadlineValid) errors.push('Deadline cannot be in the past');
    if (!isStartDateValid) errors.push('Start date cannot be in the past');
    if (formData.isOneTimeTask && !formData.deadline) errors.push('One-sitting tasks require a deadline');
    if (isOneSittingTooLong) errors.push('One-sitting task duration exceeds daily available hours');
    if (isOneSittingNoTimeSlot) errors.push('No available time slot for one-sitting task on deadline date');
    return errors;
  };

  const getValidationWarnings = () => {
    const warnings: string[] = [];
    return warnings;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) {
      setShowValidationErrors(true);
      return;
    }
    
    const category = showCustomCategory ? formData.customCategory : formData.category;
    const decimalHours = getEffectiveTotalTime();
    
    onAddTask({
      title: formData.title.trim(),
      description: formData.description.trim(),
      deadline: formData.deadline || '',
      estimatedHours: decimalHours,
      category,
      impact: formData.impact,
      status: 'pending',
      importance: formData.impact === 'high',
      deadlineType: formData.deadlineType,
      schedulingPreference: formData.schedulingPreference,
      totalTimeNeeded: formData.totalTimeNeeded ? parseFloat(formData.totalTimeNeeded) : undefined,
      isOneTimeTask: formData.isOneTimeTask,
      startDate: formData.startDate || today,
      maxSessionLength: 2, // Default max session length
    });
    setShowValidationErrors(false);
    // Reset form
    setFormData({
      title: '',
      description: '',
      deadline: '',
      estimatedHours: '',
      estimatedMinutes: '0',
      category: '',
      customCategory: '',
      impact: '',
      taskType: '',
      deadlineType: 'hard',
      schedulingPreference: 'consistent',
      isOneTimeTask: false,
      startDate: today,
      totalTimeNeeded: '',
    });
    // Hide the form after successful submission
    onCancel?.();
  };

  const handleTimeEstimationUpdate = (hours: string, minutes: string, taskType: string) => {
    setFormData(f => ({ 
      ...f, 
      estimatedHours: hours, 
      estimatedMinutes: minutes,
      taskType: taskType 
    }));
  };

  // Check if current edit form represents a low-priority urgent task
  const isLowPriorityUrgent = useMemo(() => {
    if (!formData.deadline) return false;
    const deadline = new Date(formData.deadline);
    const now = new Date();
    const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilDeadline <= 3 && formData.impact === 'low';
  }, [formData.deadline, formData.importance]);

  return (
    <div className="backdrop-blur-md bg-white/80 dark:bg-black/40 rounded-3xl shadow-2xl shadow-purple-500/10 p-8 border border-white/20 dark:border-white/10 max-w-2xl mx-auto task-input-section relative overflow-hidden">
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-violet-400/20 to-purple-500/20 rounded-full blur-xl"></div>
      <div className="relative">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent mb-6 flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Plus className="text-white" size={18} />
          </div>
          <span>Add New Task</span>
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Task Title */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
              Task Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
              className="w-full px-4 py-3 backdrop-blur-sm bg-white/70 dark:bg-black/20 border border-white/30 dark:border-white/20 rounded-xl text-base focus:ring-2 focus:ring-violet-500 focus:border-transparent dark:text-white transition-all duration-300"
              placeholder="e.g., Write project report"
            />
          </div>

          {/* 2. Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Description <span className="text-gray-400">(Optional)</span>
            </label>
            <textarea
              value={formData.description}
              onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 backdrop-blur-sm bg-white/70 dark:bg-black/20 border border-white/30 dark:border-white/20 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent dark:text-white transition-all duration-300 resize-none"
              placeholder="Add any additional details..."
              rows={2}
            />
          </div>

          {/* 3. Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Category
            </label>
            <select
              value={formData.category}
              onChange={e => setFormData(f => ({ ...f, category: e.target.value, customCategory: '' }))}
              className="w-full border border-white/30 dark:border-white/20 rounded-xl px-3 py-2 text-sm bg-white/70 dark:bg-black/20 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            >
              <option value="">Select category...</option>
              {['Academics', 'Organization', 'Work', 'Personal', 'Health', 'Learning', 'Finance', 'Home', 'Routine', 'Custom...'].map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {showCustomCategory && (
              <div className="relative mt-1">
                <input
                  type="text"
                  value={formData.customCategory}
                  onChange={e => setFormData(f => ({ ...f, customCategory: e.target.value }))}
                  className="w-full border border-white/30 dark:border-white/20 rounded-xl px-3 py-2 pr-9 text-sm bg-white/70 dark:bg-black/20 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  placeholder="Enter custom category"
                />
                {formData.customCategory && (
                  <button
                    type="button"
                    aria-label="Clear custom category"
                    title="Clear"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    onClick={() => setFormData(f => ({ ...f, customCategory: '' }))}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 4. Deadline (with Start Date to the right) */}
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  Deadline
                </label>
                <input
                  type="date"
                  min={today}
                  value={formData.deadline}
                  onChange={e => setFormData(f => ({ ...f, deadline: e.target.value }))}
                  className="w-full px-3 py-2 border border-white/30 dark:border-white/20 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white/70 dark:bg-black/20 dark:text-white"
                  placeholder="Select deadline (optional)"
                />
                {!isDeadlineValid && formData.deadline && (
                  <div className="text-red-600 text-xs mt-1">
                    Deadline cannot be in the past.
                  </div>
                )}
              </div>

              {!formData.isOneTimeTask && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    min={today}
                    value={formData.startDate}
                    onChange={e => setFormData(f => ({ ...f, startDate: e.target.value || today }))}
                    className="w-full px-3 py-2 border border-white/30 dark:border-white/20 rounded-xl text-sm bg-white/70 dark:bg-black/20 dark:text-white focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                  />
                  {!isStartDateValid && formData.startDate && (
                    <div className="text-red-600 text-xs mt-1">
                      Start date cannot be in the past.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick deadline shortcuts */}
            <div className="flex flex-wrap gap-1 text-xs">
              <button
                type="button"
                className="px-2 py-1 rounded border bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white"
                onClick={() => setFormData(f => ({ ...f, deadline: today }))}
              >
                Today
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded border bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  const iso = d.toISOString().split('T')[0];
                  setFormData(f => ({ ...f, deadline: iso }));
                }}
              >
                Tomorrow
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded border bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 7);
                  const iso = d.toISOString().split('T')[0];
                  setFormData(f => ({ ...f, deadline: iso }));
                }}
              >
                Next week
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded border bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white"
                onClick={() => setFormData(f => ({ ...f, deadline: '' }))}
              >
                Clear
              </button>
            </div>
          </div>

          {/* 5. One sitting toggle */}
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.isOneTimeTask}
                onChange={e => setFormData(f => ({ ...f, isOneTimeTask: e.target.checked }))}
                className="text-violet-600 rounded focus:ring-violet-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-200">
                Complete this task in one sitting (don't divide into sessions)
              </span>
            </label>
            {formData.isOneTimeTask && (
                <div className="mt-1 space-y-2">
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded border-l-2 border-blue-300 dark:border-blue-600">
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                       One-sitting tasks require a deadline and will be scheduled as single blocks on the deadline day, regardless of importance level.
                    </p>
                  </div>

                  {/* One-sitting task warnings */}
                  {isOneSittingTooLong && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                      <div className="flex items-start gap-2">
                        <span className="text-red-500 text-sm">���</span>
                        <div className="text-xs text-red-700 dark:text-red-200">
                          <div className="font-medium mb-1">Task Duration Too Long</div>
                          <div>This one-sitting task requires {estimatedDecimalHours}h but you only have {userSettings.dailyAvailableHours}h available per day.</div>
                          <div className="mt-2 font-medium">Solutions:</div>
                          <div className="ml-2">
                            • Reduce the estimated time<br/>
                            • Increase daily available hours in settings<br/>
                            • Uncheck "one-sitting" to allow splitting into sessions
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {isOneSittingNoTimeSlot && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg">
                      <div className="flex items-start gap-2">
                        <span className="text-red-500 text-sm">📅</span>
                        <div className="text-xs text-red-700 dark:text-red-200">
                          <div className="font-medium mb-1">No Available Time Slot</div>
                          <div>{oneSittingTimeSlotCheck.message}</div>
                          <div className="mt-2 font-medium">Solutions:</div>
                          <div className="ml-2">
                            • Choose a different deadline date<br/>
                            • Reduce the estimated time<br/>
                            • Move or remove conflicting commitments<br/>
                            • Uncheck "one-sitting" to allow flexible scheduling
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>


          {/* 7. Time Estimation */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200">
                Time Estimation <span className="text-red-500">*</span>
              </label>
              <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setEstimationMode('total')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    estimationMode === 'total'
                      ? 'bg-white dark:bg-gray-600 text-violet-600 dark:text-violet-400 shadow-sm'
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
                      ? 'bg-white dark:bg-gray-600 text-violet-600 dark:text-violet-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  Session Planning
                </button>
              </div>
            </div>

            {estimationMode === 'total' ? (
              <div className="space-y-2">
                <div className="flex items-center space-x-3">
                  <div className="flex-1 p-3 border border-white/30 dark:border-white/20 rounded-xl bg-white/70 dark:bg-black/20">
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-medium text-gray-800 dark:text-white">
                        {totalTime > 0 ? formatTimeDisplay(formData.estimatedHours, formData.estimatedMinutes) : 'Not set'}
                      </div>
                      <div className="flex items-center gap-2">
                        {formData.estimatedHours && (
                          <button
                            type="button"
                            aria-label="Clear hours"
                            title="Clear hours"
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            onClick={() => setFormData(f => ({ ...f, estimatedHours: '' }))}
                          >
                            <X size={16} />
                          </button>
                        )}
                        {(formData.estimatedMinutes && formData.estimatedMinutes !== '0') && (
                          <button
                            type="button"
                            aria-label="Clear minutes"
                            title="Clear minutes"
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            onClick={() => setFormData(f => ({ ...f, estimatedMinutes: '0' }))}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                    {formData.taskType && (
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Task type: {formData.taskType}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowTimeEstimationModal(true)}
                    className="flex items-center space-x-2 px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl transition-colors"
                  >
                    <Clock size={18} />
                    <span>Estimate</span>
                  </button>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <button
                    type="button"
                    onClick={() => setShowTimeEstimationModal(true)}
                    className="text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    Need help estimating?
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTimePresets(!showTimePresets)}
                    className="text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    {showTimePresets ? 'Hide quick presets' : 'Show quick presets'}
                  </button>
                </div>
                {showTimePresets && (
                  <div className="mt-1">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Quick presets:</div>
                    <div className="flex flex-wrap gap-1">
                      {timePresets.map((preset, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => setFormData(f => ({
                            ...f,
                            estimatedHours: preset.hours,
                            estimatedMinutes: preset.minutes,
                          }))}
                          className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-white rounded border transition-colors"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 p-4 bg-violet-50 dark:bg-violet-900/20 rounded-xl border border-violet-200 dark:border-violet-700">
                <div className="flex items-center space-x-2 text-violet-700 dark:text-violet-300">
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
                        onChange={e => {
                          const value = e.target.value;
                          if (value === '' || (/^\d*$/.test(value) && parseInt(value) >= 0 && parseInt(value) <= 8)) {
                            setSessionData(prev => ({ ...prev, sessionHours: value }));
                          }
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-white"
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
                        onChange={e => {
                          const value = e.target.value;
                          if (value === '' || /^\d*$/.test(value)) {
                            const numValue = parseInt(value) || 0;
                            if (numValue >= 0 && numValue <= 59) {
                              setSessionData(prev => ({ ...prev, sessionMinutes: value }));
                            }
                          }
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:ring-2 focus:ring-violet-500 focus:border-transparent bg-white dark:bg-gray-800 dark:text-white"
                        placeholder="0"
                      />
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minutes</div>
                    </div>
                  </div>
                </div>

                {/* Auto-calculated preview */}
                {formData.startDate && formData.deadline && (() => {
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
                              ? 'text-violet-600 dark:text-violet-400'
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

                {(!formData.startDate || !formData.deadline) && (
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
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
              Task Importance <span className="text-red-500">*</span>
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="text-gray-400 hover:text-violet-600 transition-colors"
                title="Help & Information"
              >
                <HelpCircle size={14} />
              </button>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 p-2 border border-white/30 dark:border-white/20 rounded-lg hover:bg-white/50 dark:hover:bg-black/30 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="impact"
                  value="high"
                  checked={formData.impact === 'high'}
                  onChange={() => setFormData(f => ({ ...f, impact: 'high' }))}
                  className="text-violet-600"
                />
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-white">Important</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">High priority</div>
                </div>
              </label>
              <label className="flex items-center gap-2 p-2 border border-white/30 dark:border-white/20 rounded-lg hover:bg-white/50 dark:hover:bg-black/30 cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="impact"
                  value="low"
                  checked={formData.impact === 'low'}
                  onChange={() => setFormData(f => ({ ...f, impact: 'low' }))}
                  className="text-violet-600"
                />
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-white">Standard</div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">Normal priority</div>
                </div>
              </label>
            </div>
          </div>


          {/* Validation Feedback */}
          {!isFormValid && showValidationErrors && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mt-2 dark:bg-red-900/20 dark:border-red-700">
              <div className="text-red-800 dark:text-red-200 font-medium mb-2">Please fill in the required fields:</div>
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

          {/* Low-priority urgent warning */}
          {isLowPriorityUrgent && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-2 dark:bg-yellow-900/20 dark:border-yellow-700">
              <div className="text-yellow-800 dark:text-yellow-200 font-medium mb-1">Warning: low priority with urgent deadline</div>
              <div className="text-yellow-700 dark:text-yellow-300 text-sm">
                This task is low priority but has an urgent deadline. It may not be scheduled if you have more important urgent tasks.
              </div>
            </div>
          )}

          {/* Validation Warnings */}
          {getValidationWarnings().length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mt-2 dark:bg-yellow-900/20 dark:border-yellow-700">
              <div className="text-yellow-800 dark:text-yellow-200 font-medium mb-2">⚠️ Warnings:</div>
              <ul className="text-yellow-700 dark:text-yellow-300 text-sm space-y-1">
                {getValidationWarnings().map((warning, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-yellow-500 mt-0.5">•</span>
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <button
              type="submit"
              disabled={!isFormValid}
              className={`flex-1 px-6 py-3 rounded-xl font-semibold text-white transition-all duration-300 ${
                isFormValid
                  ? 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 shadow-lg hover:shadow-xl'
                  : 'bg-gray-400 cursor-not-allowed'
              }`}
            >
              Add Task
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        {/* Time Estimation Modal */}
        <TimeEstimationModal
          isOpen={showTimeEstimationModal}
          onClose={() => setShowTimeEstimationModal(false)}
          taskType={formData.taskType}
          category={formData.category}
          initialHours={formData.estimatedHours}
          initialMinutes={formData.estimatedMinutes}
          deadline={formData.deadline}
          onEstimateUpdate={handleTimeEstimationUpdate}
        />
      </div>
    </div>
  );
};

export default TaskInputSimplified;
