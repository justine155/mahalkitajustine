import React, { useState, useEffect } from 'react';
import { Calendar, Clock, BookOpen, TrendingUp, AlertTriangle, CheckCircle, Lightbulb, X, CheckCircle2, Clock3, Settings } from 'lucide-react';
import { StudyPlan, Task, StudySession, FixedCommitment, UserSettings } from '../types';
import { formatTime, generateSmartSuggestions, getLocalDateString, checkSessionStatus, moveIndividualSession, isTaskDeadlinePast, calculateCommittedHoursForDate, getDaySpecificDailyHours } from '../utils/scheduling';

interface StudyPlanViewProps {
  studyPlans: StudyPlan[];
  tasks: Task[];
  fixedCommitments: FixedCommitment[];
  onSelectTask: (task: Task, session?: { allocatedHours: number; planDate?: string; sessionNumber?: number }) => void;
  onSelectCommitment?: (commitment: FixedCommitment, duration: number) => void;
  onGenerateStudyPlan: () => void;
  onUndoSessionDone: (planDate: string, taskId: string, sessionNumber: number) => void;
  onSkipSession: (planDate: string, taskId: string, sessionNumber: number) => void; // NEW PROP for skipping sessions
  settings: UserSettings; // Added settings prop
  onAddFixedCommitment?: (commitment: FixedCommitment) => void; // NEW PROP
  onRefreshStudyPlan?: (preserveManualReschedules: boolean) => void; // NEW PROP for refresh with options
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => void; // NEW PROP for task completion
  onSkipCommitment?: (commitmentId: string, date: string) => void; // NEW PROP for skipping commitments
}

// Force warnings UI to be hidden for all users on first load unless they have a preference
if (typeof window !== 'undefined') {
  if (localStorage.getItem('timepilot-showWarnings') === null) {
    localStorage.setItem('timepilot-showWarnings', 'false');
  }
}

// Helper function to convert decimal hours to minutes
const formatHoursToMinutes = (hours: number): string => {
  const totalMinutes = Math.round(hours * 60);
  return `${totalMinutes}m`;
};

// Helper function to get commitments for a specific date (disabled from Study Plan view)
const getCommitmentsForDate = (_date: string, _fixedCommitments: FixedCommitment[]): Array<{
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  duration: number;
  category: string;
  type: 'fixed';
  isAllDay?: boolean;
}> => {
  return [];
};

// Helper function to convert time string to minutes
const timeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

const StudyPlanView: React.FC<StudyPlanViewProps> = ({ studyPlans, tasks, fixedCommitments, onSelectTask, onSelectCommitment, onGenerateStudyPlan, onUndoSessionDone, onSkipSession, settings, onAddFixedCommitment, onRefreshStudyPlan, onUpdateTask, onSkipCommitment }) => {
  const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
  const [] = useState<{ taskTitle: string; unscheduledMinutes: number } | null>(null);
  const [showRegenerateConfirmation, setShowRegenerateConfirmation] = useState(false);
  const [showRefreshConfirmation, setShowRefreshConfirmation] = useState(false);
  const [hasManualReschedules, setHasManualReschedules] = useState(false);
  // Resched UI state
  const [reschedModal, setReschedModal] = useState<{ open: boolean; task: any | null }>({ open: false, task: null });
  const [reschedDate, setReschedDate] = useState<string>("");
  const [reschedTime, setReschedTime] = useState<string>("");
  // Track skipped tasks by title+deadline
  const [] = useState<{ title: string; deadline: string }[]>([]);
  const [, setShowCompromisedWarning] = useState(false);
  const [, setShowPlanStaleNotif] = useState(true);
  // Smart assistant state
  const [showSmartAssistant, setShowSmartAssistant] = useState(false);
  // Redistribution state
  const [redistributionInProgress, setRedistributionInProgress] = useState(false);
  // Persist showWarnings in localStorage
  const [showWarnings, setShowWarningsRaw] = useState(() => {
    const saved = localStorage.getItem('timepilot-showWarnings');
    return saved === null ? false : saved === 'true';
  });
  const setShowWarnings = (val: boolean | ((prev: boolean) => boolean)) => {
    const newVal = typeof val === 'function' ? val(showWarnings) : val;
    setShowWarningsRaw(newVal);
    localStorage.setItem('timepilot-showWarnings', newVal ? 'true' : 'false');
  };


  // Hide the warning notification on mount (e.g., when switching tabs)
  useEffect(() => {
    setShowCompromisedWarning(false);
  }, []);

  useEffect(() => {
    setShowPlanStaleNotif(true);
  }, []);

  useEffect(() => {
    setShowWarnings(true);
  }, []);


  const getTaskById = (taskId: string): Task | undefined => {
    return tasks.find(task => task.id === taskId);
  };



  const getSuggestionIcon = (type: string) => {
    switch (type) {
      case 'warning': return <AlertTriangle className="text-red-500" size={20} />;
      case 'celebration': return <CheckCircle className="text-green-500" size={20} />;
      case 'suggestion': return <Lightbulb className="text-blue-500" size={20} />;
      default: return <Lightbulb className="text-gray-500" size={20} />;
    }
  };

  const today = getLocalDateString();
  console.log('StudyPlanView - Today date format check:', {
    today,
    todayType: typeof today,
    todayLength: today.length,
    todayParts: today.split('-')
  });
  const todaysPlan = studyPlans.find(plan => plan.date === today);
  console.log('today:', today, 'studyPlans:', studyPlans.map(p => p.date));
  console.log('todaysPlan found:', !!todaysPlan);
  if (todaysPlan) {
    console.log('todaysPlan sessions:', todaysPlan.plannedTasks.map(s => ({
      taskId: s.taskId,
      sessionNumber: s.sessionNumber,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
      originalTime: s.originalTime,
      originalDate: s.originalDate
    })));
  }
  const upcomingPlans = studyPlans.filter(plan => plan.date > today).slice(0, 7);
  const suggestions = generateSmartSuggestions(tasks);



  // Calculate if the plan is feasible given the user's daily available hours and deadlines
  const allPendingDeadlines = tasks.filter(t => t.status === 'pending' && t.estimatedHours > 0).map(t => {
    const d = new Date(t.deadline);
    // Apply buffer days adjustment if buffer days is set
    if (settings.bufferDays > 0) {
      d.setDate(d.getDate() - settings.bufferDays);
    }
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  const latest = allPendingDeadlines.length > 0 ? new Date(Math.max(...allPendingDeadlines.map(d => d.getTime()))) : earliest;
  // Count number of available study days in the window
  let availableStudyDays = 0;
  const tempDate = new Date(earliest);
  while (tempDate.getTime() <= latest.getTime()) {
    if ((settings.workDays || [1,2,3,4,5,6]).includes(tempDate.getDay())) {
      availableStudyDays++;
    }
    tempDate.setDate(tempDate.getDate() + 1);
  }

  // Helper: check if a task has a rescheduled session before its deadline


  // Function to reschedule a single session using MOVE logic
  const rescheduleIndividualSession = (item: {
    session: StudySession;
    planDate: string;
    planIndex: number;
    sessionIndex: number;
  }) => {
    // Use the new MOVE-based individual session rescheduling logic
    const { success, newTime, newDate } = moveIndividualSession(
      studyPlans,
      item.session,
      item.planDate,
      settings,
      fixedCommitments
    );
    
    if (success && newTime && newDate) {
      // Call the parent handler to update the study plans
    if (onAddFixedCommitment) {
      const newFixedCommitment: FixedCommitment = {
        id: 'manual-resched-' + Date.now(),
        title: item.session.taskId + ' (Manual Resched)',
        startTime: newTime,
        endTime: newTime, // This will be calculated properly in the parent handler
        recurring: false,
        daysOfWeek: [],
        specificDates: [newDate],
        category: 'personal',
        createdAt: new Date().toISOString(),
      };
      onAddFixedCommitment(newFixedCommitment);
      setNotificationMessage(
        `Added fixed commitment: ${newFixedCommitment.title} on ${newDate} from ${newTime} to ${newTime}`
      );
    } else {
      setNotificationMessage(`Moved ${getTaskById(item.session.taskId)?.title || 'session'} to ${newTime}`);
    }
    
    // Remove this session from the reschedule UI
    
    } else {
      setNotificationMessage(`Failed to move ${getTaskById(item.session.taskId)?.title || 'session'}`);
    }
  };





  const todayDateObj = new Date();
  const todayDayOfWeek = todayDateObj.getDay();
  const isTodayWorkDay = (settings.workDays || [1,2,3,4,5,6]).includes(todayDayOfWeek);

  const activeTasks = tasks.filter(task => task.status === 'pending' && task.estimatedHours > 0);

  // Dummy variables for missed sessions (feature removed - forward focus approach)
  const missedSessions: any[] = [];
  const overdueMissedSessions: any[] = [];
  const showMissedSessions = false;

  // Handler for marking overdue tasks as completed
  const handleMarkTaskAsCompleted = (taskId: string) => {
    if (onUpdateTask) {
      onUpdateTask(taskId, { status: 'completed' });
      setNotificationMessage('Task marked as completed');
    }
  };


  // Function to check if there are manual reschedules
  const checkForManualReschedules = () => {
    return studyPlans.some(plan =>
      plan.plannedTasks.some(session =>
        session.originalTime && session.originalDate && session.isManualOverride
      )
    );
  };

  // Handle refresh button click
  const handleRefreshClick = () => {
    const hasReschedules = checkForManualReschedules();
    if (hasReschedules) {
      setHasManualReschedules(true);
      setShowRefreshConfirmation(true);
    } else {
      // No manual reschedules, directly refresh
      if (onRefreshStudyPlan) {
        onRefreshStudyPlan(false);
      }
    }
  };

  // Handle refresh confirmation
  const handleRefreshConfirm = (preserveReschedules: boolean) => {
    setShowRefreshConfirmation(false);
    if (onRefreshStudyPlan) {
      onRefreshStudyPlan(preserveReschedules);
    }
  };

  return (
    <div className="space-y-6 relative study-plan-container">

      {/* Resched Modal */}
      {reschedModal.open && reschedModal.task && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                  <Clock className="text-blue-500" size={24} />
                  <span>Reschedule Unscheduled Hours</span>
                </h2>
                <button
                  onClick={() => setReschedModal({ open: false, task: null })}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="mb-4">
                <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{reschedModal.task.title}</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                  {reschedModal.task.unscheduledHours >= 1
                    ? `${Math.floor(reschedModal.task.unscheduledHours)} hour${reschedModal.task.unscheduledHours >= 2 ? 's' : ''}`
                    : `${Math.round(reschedModal.task.unscheduledHours * 60)} min`} unscheduled
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Select Day</label>
                  <input
                    type="date"
                    className="border rounded px-2 py-1 dark:bg-gray-700 dark:text-white"
                    value={reschedDate}
                    onChange={e => setReschedDate(e.target.value)}
                  />
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-200 mt-2">Select Start Time</label>
                  <input
                    type="time"
                    className="border rounded px-2 py-1 dark:bg-gray-700 dark:text-white"
                    value={reschedTime}
                    onChange={e => setReschedTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setReschedModal({ open: false, task: null })}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  disabled={!reschedDate || !reschedTime}
                  onClick={() => {
                    // Calculate end time
                    const [reschedHour, reschedMinute] = reschedTime.split(":").map(Number);
                    const reschedStartDate = new Date(reschedDate + 'T' + reschedTime);
                    const reschedEndDate = new Date(reschedStartDate.getTime() + reschedModal.task.unscheduledHours * 60 * 60 * 1000);
                    const pad = (n: number) => n.toString().padStart(2, '0');
                    const reschedStartTime = pad(reschedHour) + ':' + pad(reschedMinute);
                    const reschedEndTime = pad(reschedEndDate.getHours()) + ':' + pad(reschedEndDate.getMinutes());
                    // const reschedDayOfWeek = new Date(reschedDate).getDay();
                    const newFixedCommitment: FixedCommitment = {
                      id: 'manual-resched-' + Date.now(),
                      title: reschedModal.task.title + ' (Manual Resched)',
                      startTime: reschedStartTime,
                      endTime: reschedEndTime,
                      recurring: false,
                      daysOfWeek: [],
                      specificDates: [reschedDate],
                      category: 'personal',
                      createdAt: new Date().toISOString(),
                    };
                    if (onAddFixedCommitment) {
                      onAddFixedCommitment(newFixedCommitment);
                      setNotificationMessage(
                        `Added fixed commitment: ${newFixedCommitment.title} on ${reschedDate} from ${reschedStartTime} to ${reschedEndTime}`
                      );
                    } else {
                      setNotificationMessage(
                        `Added fixed commitment: ${newFixedCommitment.title} on ${reschedDate} from ${reschedStartTime} to ${reschedEndTime}`
                      );
                    }
                    setReschedModal({ open: false, task: null });
                  }}
                  className={`px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors ${(!reschedDate || !reschedTime) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Test Data Setup (Development Only) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg dark:bg-yellow-900/20 dark:border-yellow-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">🧪 Testing Mode</h3>
              <p className="text-xs text-yellow-600 dark:text-yellow-300 mt-1">
                Click to create realistic test data with proper deadlines, mixed session results, and overdue tasks
              </p>
            </div>
            <button
              onClick={() => {
                if ((window as any).setupRealisticTestData) {
                  (window as any).setupRealisticTestData();
                } else {
                  setNotificationMessage('Realistic test data setup not available');
                }
              }}
              className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200 transition-colors dark:bg-yellow-900 dark:text-yellow-200 dark:hover:bg-yellow-800"
            >
              Setup Realistic Test Data
            </button>
          </div>
        </div>
      )}

      {/* Generate Study Plan Button (only if no study plan exists and there are active tasks) */}
      {studyPlans.length === 0 && activeTasks.length > 0 && (
      <div className="flex justify-end space-x-3">
        <button
            className={`px-4 py-2 rounded-lg font-semibold shadow transition-colors duration-200 bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:from-blue-600 hover:to-purple-700`}
          onClick={() => {
              setShowRegenerateConfirmation(true);
          }}
        >
            Generate Study Plan
        </button>
      </div>
      )}

      {/* Generate Confirmation Modal */}
      {showRegenerateConfirmation && studyPlans.length === 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                  <AlertTriangle className="text-orange-500" size={24} />
                  <span>Generate Study Plan?</span>
                </h2>
                <button
                  onClick={() => setShowRegenerateConfirmation(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="space-y-4">
                <p className="text-gray-600 dark:text-gray-300">
                  This will create a new study plan based on your current active tasks and settings.
                </p>
                  </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => setShowRegenerateConfirmation(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onGenerateStudyPlan();
                    setShowRegenerateConfirmation(false);
                    setNotificationMessage('Study plan generated successfully!');
                    setTimeout(() => setNotificationMessage(null), 3000);
                  }}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-colors"
                >
                  Yes, Generate Plan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Refresh Confirmation Modal */}
      {showRefreshConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                  <AlertTriangle className="text-orange-500" size={24} />
                  <span>Refresh Study Plan?</span>
                </h2>
                <button
                  onClick={() => setShowRefreshConfirmation(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="space-y-4">
                <p className="text-gray-600 dark:text-gray-300">
                  You have manually rescheduled sessions. Refreshing the study plan will affect these changes.
                </p>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-200 dark:border-yellow-700">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    <strong>Choose an option:</strong>
                  </p>
                  <ul className="text-sm text-yellow-700 dark:text-yellow-300 mt-1 space-y-1">
                    <li>• <strong>Preserve reschedules:</strong> Keep your manual changes and optimize around them</li>
                    <li>• <strong>Start fresh:</strong> Reset all sessions to optimally calculated times</li>
                  </ul>
                </div>
              </div>
              <div className="flex flex-col space-y-2 mt-6">
                <button
                  onClick={() => handleRefreshConfirm(true)}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-green-600 text-white rounded-lg hover:from-blue-600 hover:to-green-700 transition-colors"
                >
                  Preserve My Manual Reschedules
                </button>
                <button
                  onClick={() => handleRefreshConfirm(false)}
                  className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-lg hover:from-orange-600 hover:to-red-700 transition-colors"
                >
                  Start Fresh (Reset All)
                </button>
                <button
                  onClick={() => setShowRefreshConfirmation(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Options Modal */}
      

      {/* Notification Message */}
      {notificationMessage && (
        <div className={`p-4 rounded-lg flex items-center justify-between ${
          notificationMessage.includes('successfully') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          <p className="font-medium">{notificationMessage}</p>
          <button onClick={() => setNotificationMessage(null)} className="text-current hover:opacity-75">
            <X size={20} />
          </button>
        </div>
      )}


      
      {/* Daily Capacity Overview */}
      {studyPlans.length > 0 && todaysPlan && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-blue-100 dark:bg-blue-900/30 rounded-full p-2">
                <Clock className="text-blue-600 dark:text-blue-400" size={20} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 dark:text-white">Today's Capacity</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">Your planned work breakdown</p>
              </div>
            </div>
            <div className="text-right">
              {(() => {
                const taskHours = todaysPlan.plannedTasks.filter(session => {
                  const sessionStatus = checkSessionStatus(session, todaysPlan.date);
                  return sessionStatus !== 'missed' && session.status !== 'skipped';
                }).reduce((sum, session) => sum + session.allocatedHours, 0);
                const committedHours = calculateCommittedHoursForDate(todaysPlan.date, fixedCommitments);
                const totalPlannedHours = taskHours + committedHours;
                const dailyCapacity = getDaySpecificDailyHours(todaysPlan.date, settings);
                const remainingHours = Math.max(0, dailyCapacity - totalPlannedHours);

                return (
                  <div className="space-y-1">
                    <div className="text-lg font-bold text-gray-800 dark:text-white">
                      {formatTime(totalPlannedHours)} / {formatTime(dailyCapacity)}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                      <div>📝 Tasks: {formatTime(taskHours)}</div>
                      {committedHours > 0 && <div>📊 Commitments: {formatTime(committedHours)}</div>}
                      <div className={remainingHours > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                        {remainingHours > 0 ? `⚡ Available: ${formatTime(remainingHours)}` : "⚠️ Overloaded"}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Today's Study Plan */}
      {!isTodayWorkDay ? (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6 dark:bg-gray-900 dark:shadow-gray-900">
          <div className="flex items-center mb-4">
            <Calendar className="text-blue-600 dark:text-blue-400" size={24} />
            <h2 className="text-xl font-semibold text-gray-800 ml-2 dark:text-white">Today's Sessions</h2>
          </div>
          <div className="text-center py-8">
            <div className="text-6xl mb-4">🎉</div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2 dark:text-white">No Work Today!</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              It's your day off! Time to relax, recharge, and maybe catch up on some Netflix. 🎮
            </p>
            <div className="bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900 dark:to-pink-900 rounded-lg p-4">
              <p className="text-sm text-gray-700 dark:text-gray-200">
                <span className="font-medium">Pro tip:</span> Use this time to plan your next study session or just enjoy your well-deserved break! ✨
              </p>
            </div>
          </div>
        </div>
      ) : todaysPlan ? (
        <div className="bg-gray-50 rounded-xl shadow-lg p-6 mb-6 dark:bg-gray-900 dark:shadow-gray-900">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-800 flex items-center space-x-2 dark:text-white">
              <Calendar className="text-blue-600 dark:text-blue-400" size={24} />
              <span>Today's Sessions</span>
              {suggestions.length > 0 && (
                <button
                  onClick={() => setShowSmartAssistant(true)}
                  className="ml-2 px-3 py-1.5 bg-yellow-100 hover:bg-yellow-200 rounded-lg transition-colors duration-200 dark:bg-yellow-900 dark:hover:bg-yellow-800 text-sm flex items-center space-x-1"
                  title="View optimization suggestions"
                >
                  <Lightbulb className="text-yellow-600 dark:text-yellow-400" size={16} />
                  <span className="text-yellow-800 dark:text-yellow-200 font-medium">{suggestions.length}</span>
                  <span className="text-yellow-700 dark:text-yellow-300">tips</span>
                </button>
              )}
            </h2>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-500 dark:text-gray-300">
                {(() => {
                  const taskHours = todaysPlan.plannedTasks.filter(session => {
                    const sessionStatus = checkSessionStatus(session, todaysPlan.date);
                    return sessionStatus !== 'missed' && session.status !== 'skipped';
                  }).reduce((sum, session) => sum + session.allocatedHours, 0);
                  const committedHours = calculateCommittedHoursForDate(todaysPlan.date, fixedCommitments);
                  const totalPlannedHours = taskHours + committedHours;

                  return (
                    <div className="space-y-1">
                      <div>{formatTime(totalPlannedHours)} total work planned</div>
                      {committedHours > 0 && (
                        <div className="text-xs text-blue-600 dark:text-blue-400">
                          ({formatTime(taskHours)} tasks + {formatTime(committedHours)} commitments)
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              {todaysPlan.isOverloaded && (
                <div className="flex items-center space-x-2">
                  <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full dark:bg-red-900 dark:text-red-300">
                    Busy day!
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({(() => {
                      const taskHours = todaysPlan.plannedTasks.filter(session => {
                        const sessionStatus = checkSessionStatus(session, todaysPlan.date);
                        return sessionStatus !== 'missed' && session.status !== 'skipped';
                      }).reduce((sum, session) => sum + session.allocatedHours, 0);
                      const committedHours = calculateCommittedHoursForDate(todaysPlan.date, fixedCommitments);
                      const totalHours = taskHours + committedHours;
                      const dailyCapacity = getDaySpecificDailyHours(plan.date, settings);
                      return `${formatTime(totalHours)} / ${formatTime(dailyCapacity)} total hours`;
                    })()})
                  </span>
                  <span className="text-xs text-blue-500 dark:text-blue-400" title="Buffer time between sessions is not counted in study hours">
                    + buffer time
                  </span>
                </div>
              )}
            </div>
          </div>
          
          
          {(() => {
            // Combine tasks and commitments for chronological sorting
            const tasks = todaysPlan.plannedTasks
              .filter(session => session.status !== 'skipped') // Hide skipped sessions from UI
              .map(session => ({ ...session, type: 'task' as const }));

            const commitments = getCommitmentsForDate(todaysPlan.date, fixedCommitments)
              .map(commitment => ({ ...commitment, type: 'commitment' as const }));

            // Combine and sort all items by start time
            const allItems = [...tasks, ...commitments]
              .sort((a, b) => {
                // Sort by current start time chronologically
                const [aHour, aMinute] = (a.startTime || '00:00').split(':').map(Number);
                const [bHour, bMinute] = (b.startTime || '00:00').split(':').map(Number);
                const aMinutes = aHour * 60 + aMinute;
                const bMinutes = bHour * 60 + bMinute;
                return aMinutes - bMinutes;
              });

            return allItems.map((item) => {
              if (item.type === 'task') {
                const session = item;
            const task = getTaskById(session.taskId);
            if (!task) return null;
            const isDone = session.done;
            const isCompleted = session.status === 'completed';
            
            // Check session status for missed/overdue/rescheduled
            const sessionStatus = checkSessionStatus(session, todaysPlan.date);
            const isRescheduled = sessionStatus === 'rescheduled';
            
            // Enhanced color system for session status and importance
            const statusColors = {
  completed: {
    bg: 'bg-emerald-100 dark:bg-emerald-800/40',
    border: 'border-emerald-300 dark:border-emerald-600',
    text: 'text-emerald-800 dark:text-emerald-200',
    icon: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-700 dark:text-emerald-100'
  },
  missed: {
    bg: 'bg-red-100 dark:bg-red-800/40',
    border: 'border-red-300 dark:border-red-600',
    text: 'text-red-800 dark:text-red-200',
    icon: 'text-red-600 dark:text-red-400',
    badge: 'bg-red-200 text-red-900 dark:bg-red-700 dark:text-red-100'
  },
  overdue: {
    bg: 'bg-amber-100 dark:bg-amber-800/40',
    border: 'border-amber-300 dark:border-amber-600',
    text: 'text-amber-800 dark:text-amber-200',
    icon: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-200 text-amber-900 dark:bg-amber-700 dark:text-amber-100'
  },
  rescheduled: {
    bg: 'bg-indigo-100 dark:bg-indigo-800/40',
    border: 'border-indigo-300 dark:border-indigo-600',
    text: 'text-indigo-800 dark:text-indigo-200',
    icon: 'text-indigo-600 dark:text-indigo-400',
    badge: 'bg-indigo-200 text-indigo-900 dark:bg-indigo-700 dark:text-indigo-100'
  },
  scheduled: {
    bg: 'bg-white dark:bg-gray-800',
    border: 'border-gray-200 dark:border-gray-700',
    text: 'text-gray-800 dark:text-gray-200',
    icon: 'text-gray-600 dark:text-gray-400',
    badge: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
  }
};

            const importanceColors = {
              high: {
                ring: 'ring-2 ring-purple-200 dark:ring-purple-800',
                badge: 'bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200',
                icon: 'text-purple-500 dark:text-purple-400'
              },
              low: {
                ring: '',
                badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
                icon: 'text-slate-500 dark:text-slate-400'
              }
            };

            // Determine session status and styling
            let currentSessionStatus = 'scheduled';
            let icon = null;
            let statusText = '';
            
            if (isDone || isCompleted) {
              currentSessionStatus = 'completed';
              icon = <CheckCircle2 className={`${statusColors.completed.icon}`} size={20} />;
            } else if (sessionStatus === 'missed') {
              currentSessionStatus = 'missed';
              icon = <AlertTriangle className={`${statusColors.missed.icon}`} size={20} />;
              statusText = 'Missed';
            } else if (isRescheduled) {
              currentSessionStatus = 'rescheduled';
              icon = <Clock3 className={`${statusColors.rescheduled.icon}`} size={20} />;
              statusText = 'Rescheduled';
            } else {
              icon = <Clock3 className={`${statusColors.scheduled.icon}`} size={20} />;
            }

            const currentStatusColors = statusColors[currentSessionStatus as keyof typeof statusColors];
            const importanceLevel = task.importance ? 'high' : 'low';
            const importanceStyle = importanceColors[importanceLevel];

            // Calculate task progress (similar to Dashboard)
            const allSessionsForTask = studyPlans.flatMap(plan => plan.plannedTasks).filter(s => s.taskId === task.id);
            const completedSessions = allSessionsForTask.filter(s => s.done || s.status === 'completed');
            const totalSessions = allSessionsForTask.length;
            const sessionNumber = session.sessionNumber || 1;
            
                          return (
                <div
  key={`today-${session.taskId}-${session.sessionNumber || 0}-${session.startTime || ''}-${todaysPlan.date}`}
  className={`p-3 mb-3 rounded-lg border study-session-item transition-all duration-300 shadow-sm hover:shadow-md ${!isDone && !isCompleted && sessionStatus !== 'missed' ? 'cursor-pointer sm:hover:scale-[1.01]' : 'cursor-default'} ${currentStatusColors.bg} ${currentStatusColors.border} overflow-hidden`}
  onClick={() => !isDone && !isCompleted && sessionStatus !== 'missed' && todaysPlan && onSelectTask(task, { allocatedHours: session.allocatedHours, planDate: todaysPlan.date, sessionNumber: session.sessionNumber })}
>
                <div className="space-y-2"> {/* Reduced from space-y-4 */}
  <div className="w-full">
    {/* Header with icon, title, and status - More compact */}
    <div className="space-y-1 mb-2"> {/* Reduced spacing */}
      <div className="flex items-center space-x-2"> {/* Reduced from space-x-3 */}
        <div className="flex-shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`font-medium text-base truncate ${  // Reduced from text-lg and added truncate
            isDone || isCompleted || sessionStatus === 'missed'
              ? 'line-through opacity-60'
              : currentStatusColors.text
          }`}>
            {task.title}
          </h3>
          {task.category && (
            <span className="text-xs text-gray-600 dark:text-gray-400 truncate block">
              {task.category}
            </span>
          )}
        </div>
        {/* Move status badge inline with title */}
        {statusText && (
          <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${currentStatusColors.badge}`}>
            {statusText}
          </span>
        )}
      </div>
    </div>

    {/* Compact time and session info - Responsive layout */}
    <div className="mb-2"> {/* Reduced from mb-3 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
        {/* Top/Left side: Time and duration */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1 px-2 py-1 bg-gray-50 dark:bg-gray-700 rounded text-xs flex-shrink-0"> {/* Reduced padding */}
            <Clock size={14} className="text-gray-500 dark:text-gray-400" /> {/* Smaller icon */}
            <span className="font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
              {session.startTime} - {session.endTime}
            </span>
          </div>
          <div className="flex items-center space-x-1 px-2 py-1 bg-gray-50 dark:bg-gray-700 rounded text-xs flex-shrink-0">
            <TrendingUp size={14} className="text-gray-500 dark:text-gray-400" />
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {formatTime(session.allocatedHours)}
            </span>
          </div>
        </div>

        {/* Bottom/Right side: Session info, due date, and importance */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
            Session {sessionNumber}/{totalSessions}
          </span>
          <span className="text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
            Due: {new Date(task.deadline).toLocaleDateString()}
          </span>
          <span className={`px-2 py-0.5 text-xs rounded-full font-medium whitespace-nowrap ${
            task.importance
              ? 'bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-200'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
          }`}>
            {task.importance ? 'Important' : 'Normal'}
          </span>
        </div>
      </div>
    </div>

    {/* Rescheduled info - more compact */}
    {isRescheduled && session.originalTime && (
      <div className="text-xs bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded text-blue-700 dark:text-blue-300">
        Moved from {session.originalTime}
        {session.originalDate && session.originalDate !== todaysPlan.date && (
          <span> ({new Date(session.originalDate).toLocaleDateString()})</span>
        )}
      </div>
    )}
  </div>
</div>
                {/* Undo button for completed sessions */}
                {(isDone || isCompleted) && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (todaysPlan) {
                        onUndoSessionDone(todaysPlan.date, session.taskId, session.sessionNumber || 0);
                      }
                    }}
                    className="ml-4 px-3 py-1 text-xs bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors duration-200 dark:bg-orange-900 dark:text-orange-300 dark:hover:bg-orange-800"
                    title="Undo completion"
                  >
                    Undo
                  </button>
                )}

                {/* Skip button for active sessions */}
                {!isDone && !isCompleted && sessionStatus !== 'missed' && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      if (todaysPlan) {
                        onSkipSession(todaysPlan.date, session.taskId, session.sessionNumber || 0);
                      }
                    }}
                    className="ml-4 px-3 py-1 text-xs bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors duration-200 dark:bg-yellow-900 dark:text-yellow-300 dark:hover:bg-yellow-800"
                    title="Skip this session"
                  >
                    Skip
                  </button>
                )}
              </div>
                );
              } else {
                // Render commitment
                const commitment = item;
                return (
                  <div
                    key={`commitment-${commitment.id}`}
                    className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 mb-3 hover:shadow-md transition-all duration-200"
                  >
                    <div
                      className="cursor-pointer"
                      onClick={() => {
                        if (onSelectCommitment) {
                          const fixedCommitment = fixedCommitments.find(c => c.id === commitment.id);
                          if (fixedCommitment) {
                            onSelectCommitment(fixedCommitment, commitment.duration);
                          }
                        }
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-3">
                          <div className="flex items-center space-x-2">
                            <div className="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg">
                              <Settings className="text-blue-600 dark:text-blue-400" size={16} />
                            </div>
                            <div>
                              <h3 className="font-medium text-blue-800 dark:text-blue-200">{commitment.title}</h3>
                              <div className="flex items-center space-x-4 text-sm text-blue-600 dark:text-blue-400">
                                <span className="flex items-center space-x-1">
                                  <Clock size={14} />
                                  <span>{commitment.startTime} - {commitment.endTime}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <BookOpen size={14} />
                                  <span>{formatHoursToMinutes(commitment.duration)}</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                            {commitment.category}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Skip button for commitments */}
                    <div className="flex justify-end mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSkipCommitment && todaysPlan) {
                            onSkipCommitment(commitment.id, todaysPlan.date);
                          }
                        }}
                        className="px-3 py-1 text-xs bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors duration-200 dark:bg-orange-900 dark:text-orange-300 dark:hover:bg-orange-800"
                        title="Mark this commitment as cancelled/couldn't attend"
                      >
                        Mark as Cancelled
                      </button>
                    </div>
                  </div>
                );
              }
            });
          })()}

          {/* Show "No Sessions Planned" message when all sessions and commitments are filtered out */}
          {(() => {
            const hasTasks = todaysPlan.plannedTasks.filter(session => session.status !== 'skipped').length > 0;
            const hasCommitments = getCommitmentsForDate(todaysPlan.date, fixedCommitments).length > 0;
            return !hasTasks && !hasCommitments;
          })() && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">📚</div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2 dark:text-white">No Sessions Planned</h3>
              <p className="text-gray-600 dark:text-gray-300">
                You have no study sessions planned for today. Time to generate a study plan! 🚀
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6 dark:bg-gray-900 dark:shadow-gray-900">
          <div className="flex items-center mb-4">
            <Calendar className="text-blue-600 dark:text-blue-400" size={24} />
            <h2 className="text-xl font-semibold text-gray-800 ml-2 dark:text-white">Today's Sessions</h2>
          </div>

          {/* Show commitments even without a study plan */}
          {(() => {
            const todaysCommitments = getCommitmentsForDate(today, fixedCommitments);
            if (todaysCommitments.length > 0) {
              return (
                <div className="space-y-3 mb-6">
                  <div className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                    📊 Your productive commitments for today:
                  </div>
                  {todaysCommitments.map((commitment) => (
                    <div
                      key={`commitment-${commitment.id}`}
                      className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-3 sm:p-4 hover:shadow-md transition-all duration-200"
                    >
                      <div
                        className="cursor-pointer"
                        onClick={() => {
                          if (onSelectCommitment) {
                            const fixedCommitment = fixedCommitments.find(c => c.id === commitment.id);
                            if (fixedCommitment) {
                              onSelectCommitment(fixedCommitment, commitment.duration);
                            }
                          }
                        }}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
                          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
                            <div className="flex-shrink-0 p-2 bg-blue-100 dark:bg-blue-800 rounded-lg">
                              <Settings className="text-blue-600 dark:text-blue-400" size={16} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="font-medium text-blue-800 dark:text-blue-200 truncate">{commitment.title}</h3>
                              <div className="flex flex-wrap items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                                <span className="flex items-center space-x-1 flex-shrink-0">
                                  <Clock size={14} />
                                  <span className="whitespace-nowrap">{commitment.startTime} - {commitment.endTime}</span>
                                </span>
                                <span className="flex items-center space-x-1 flex-shrink-0">
                                  <BookOpen size={14} />
                                  <span>{formatHoursToMinutes(commitment.duration)}</span>
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 whitespace-nowrap">
                              {commitment.category}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Skip button for commitments */}
                      <div className="flex justify-end mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSkipCommitment) {
                              onSkipCommitment(commitment.id, today);
                            }
                          }}
                          className="px-3 py-1 text-xs bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors duration-200 dark:bg-orange-900 dark:text-orange-300 dark:hover:bg-orange-800"
                          title="Mark this commitment as cancelled/couldn't attend"
                        >
                          Mark as Cancelled
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            }
            return null;
          })()}

          {/* Show "No Sessions Planned" only if there are no commitments either */}
          {(() => {
            const todaysCommitments = getCommitmentsForDate(today, fixedCommitments);
            if (todaysCommitments.length === 0) {
              return (
                <div className="text-center py-8">
                  <div className="text-4xl mb-4">📚</div>
                  <h3 className="text-xl font-semibold text-gray-800 mb-2 dark:text-white">No Sessions Planned</h3>
                  <p className="text-gray-600 dark:text-gray-300">
                    You have no study sessions or productive commitments planned for today. Time to generate a study plan! 🚀
                  </p>
                </div>
              );
            }
            return (
              <div className="text-center py-4">
                <div className="text-2xl mb-2">✅</div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2 dark:text-white">Only Commitments Today</h3>
                <p className="text-gray-600 dark:text-gray-300">
                  You have productive commitments but no study tasks scheduled. Add some tasks to generate a study plan! 📚
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Upcoming Study Plans */}
      {upcomingPlans.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6 dark:bg-gray-900 dark:shadow-gray-900">
          <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center space-x-2 dark:text-white">
            <BookOpen className="text-purple-600 dark:text-purple-400" size={24} />
            <span>What's Coming Up</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {upcomingPlans
              .filter(plan => plan.plannedTasks && plan.plannedTasks.filter(session => session.status !== 'skipped').length > 0)
              .map((plan) => (
                <div key={plan.id} className="border rounded-lg p-4 dark:bg-gray-800 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-800 dark:text-white">
                      {new Date(plan.date).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </h3>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-500 dark:text-gray-300">
                        {(() => {
                          // Calculate task session hours
                          const taskHours = plan.plannedTasks
                            .filter(session => session.status !== 'skipped')
                            .reduce((sum, session) => sum + session.allocatedHours, 0);

                          // Calculate commitment hours for this date
                          const commitmentHours = calculateCommittedHoursForDate(plan.date, fixedCommitments);

                          const totalHours = taskHours + commitmentHours;
                          return formatTime(totalHours);
                        })()} of work
                      </span>
                      {plan.isOverloaded && (
                        <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full dark:bg-yellow-900 dark:text-yellow-300">
                          Packed!
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {(() => {
                      // Get tasks for this plan
                      const tasks = plan.plannedTasks
                        .filter(session => session.status !== 'skipped')
                        .map(session => ({ ...session, type: 'task' as const }));

                      // Get commitments for this date
                      const commitments = getCommitmentsForDate(plan.date, fixedCommitments)
                        .map(commitment => ({ ...commitment, type: 'commitment' as const }));

                      // Combine and sort all items by start time (same as today's logic)
                      const allItems = [...tasks, ...commitments]
                        .sort((a, b) => {
                          // Sort by current start time chronologically
                          const [aHour, aMinute] = (a.startTime || '00:00').split(':').map(Number);
                          const [bHour, bMinute] = (b.startTime || '00:00').split(':').map(Number);
                          const aMinutes = aHour * 60 + aMinute;
                          const bMinutes = bHour * 60 + bMinute;
                          return aMinutes - bMinutes;
                        });

                      return allItems.map((item) => {
                        if (item.type === 'task') {
                          const session = item;
                          const task = getTaskById(session.taskId);
                          if (!task) return null;
                          const sessionStatus = checkSessionStatus(session, plan.date);
                          const isRescheduled = sessionStatus === 'rescheduled';

                          return (
                            <div
                              key={`upcoming-${session.taskId}-${session.sessionNumber || 0}-${session.startTime || ''}-${plan.date}`}
                              className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-2 rounded space-y-1 sm:space-y-0 ${
                                isRescheduled
                                  ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
                                  : 'bg-gray-50 dark:bg-gray-900'
                              }`}
                            >
                              <div className="flex items-center space-x-2 min-w-0 flex-1">
                                <span className={`text-sm font-medium truncate ${
                                  isRescheduled
                                    ? 'text-blue-700 dark:text-blue-300'
                                    : 'text-gray-700 dark:text-gray-200'
                                }`}>
                                  {task.title}
                                </span>
                                {task.category && (
                                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">({task.category})</span>
                                )}
                                {isRescheduled && (
                                  <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full dark:bg-blue-900 dark:text-blue-300 whitespace-nowrap">
                                    Rescheduled
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center space-x-2 flex-shrink-0">
                                <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-300">
                                  <span className="whitespace-nowrap">{session.startTime} - {session.endTime}</span>
                                  <span>-</span>
                                  <span>{formatTime(session.allocatedHours)}</span>
                                  {isRescheduled && session.originalTime && (
                                    <span className="text-blue-600 dark:text-blue-400 whitespace-nowrap">
                                      (from {session.originalTime})
                                    </span>
                                  )}
                                </div>
                                {/* Skip button removed from upcoming sessions - only for today's sessions */}
                              </div>
                            </div>
                          );
                        } else {
                          // Commitment item
                          const commitment = item;
                          return (
                            <div
                              key={`upcoming-commitment-${commitment.id}`}
                              className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-2 rounded bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 space-y-1 sm:space-y-0"
                            >
                              <div className="flex items-center space-x-2">
                                <div className="flex items-center space-x-1">
                                  <Settings className="text-blue-600 dark:text-blue-400" size={14} />
                                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300 truncate">
                                    {commitment.title}
                                  </span>
                                </div>
                                <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full dark:bg-blue-900 dark:text-blue-300">
                                  {commitment.category}
                                </span>
                              </div>
                              <div className="flex items-center space-x-2 text-xs text-blue-600 dark:text-blue-400">
                                <span>{commitment.startTime} - {commitment.endTime}</span>
                                <span>-</span>
                                <span>{formatTime(commitment.duration)}</span>
                              </div>
                            </div>
                          );
                        }
                      });
                    })()}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Study Plan Header with Refresh Button and Missed Sessions */}
      {studyPlans.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6 dark:bg-gray-900 dark:shadow-gray-900">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Calendar className="text-blue-600 dark:text-blue-400" size={24} />
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white">Study Plan Management</h2>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleRefreshClick}
                className="px-4 py-2 bg-gradient-to-r from-green-500 to-blue-600 text-white text-sm rounded-lg hover:from-green-600 hover:to-blue-700 transition-colors flex items-center space-x-2"
                title="Refresh and regenerate your study plan"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh Plan</span>
              </button>

            </div>
          </div>

          {/* Missed Sessions feature removed - forward focus approach: past sessions are ignored */}
          {false && (
            <div className="border-t pt-4 mt-4 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setShowMissedSessions(!showMissedSessions)}
                  className="flex items-center space-x-2 hover:opacity-80 transition-opacity"
                >
                  <AlertTriangle className="text-red-500 dark:text-red-400" size={20} />
                  <h3 className="text-lg font-medium text-gray-800 dark:text-white">Missed Sessions</h3>
                  <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                    {missedSessions.length + overdueMissedSessions.length} total
                  </span>
                  {missedSessions.length > 0 && (
                    <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
                      {missedSessions.length} redistributable
                    </span>
                  )}
                  {overdueMissedSessions.length > 0 && (
                    <span className="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300">
                      {overdueMissedSessions.length} overdue
                    </span>
                  )}
                  <div className={`transform transition-transform ${showMissedSessions ? 'rotate-90' : ''}`}>
                    <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
                {!showMissedSessions && (
                  <div className="text-sm text-gray-600 dark:text-gray-400 italic">
                    Click to {missedSessions.length + overdueMissedSessions.length > 0 ? 'manage missed sessions' : 'view details'}
                  </div>
                )}
              </div>

              {showMissedSessions && (
                <>
                  <div className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                    {(missedSessions.length > 0 || overdueMissedSessions.length > 0) ? (
                      <>
                        <p>You have missed study sessions. Available actions:</p>
                        <ul className="mt-2 space-y-1">
                          <li>• <strong>Start Now</strong> - work on any missed session immediately</li>
                          <li>• <strong>Skip</strong> - mark session as completed (forget about it)</li>
                          <li>• <strong>Mark Task Done</strong> - complete entire task (for overdue tasks)</li>
                          <li>• <strong>Refresh Plan</strong> - generate new optimal schedule (missed sessions stay here)</li>
                        </ul>
                        {(missedSessions.length > 0 || overdueMissedSessions.length > 0) && (
                          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                            <p className="text-blue-800 dark:text-blue-200 text-xs">
                              <strong>How Refresh Works:</strong> Refreshing creates a fresh study plan for your active tasks.
                              All missed sessions will remain here for you to handle manually.
                            </p>
                            <p className="text-blue-700 dark:text-blue-300 text-xs mt-2">
                              <strong>Your choice:</strong> Start missed sessions now, skip them, mark tasks complete, or ignore them and focus on your new plan.
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p>No missed sessions found. All past study sessions have been completed or are up to date.</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    {/* Redistributable Sessions */}
                    {missedSessions.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Sessions that can be handled:
                        </h4>
                        {missedSessions.map(({planDate, session, task}, idx) => (
                          <div key={`missed-${planDate}-${session.sessionNumber || 0}-${task.id}-${session.startTime || ''}-${idx}`}
                               className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-all duration-200">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-2">
                                <BookOpen className="text-blue-500 dark:text-blue-400" size={18} />
                                <h3 className="font-medium text-gray-800 dark:text-white">{task.title}</h3>
                                {task.category && (
                                  <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full dark:bg-blue-900 dark:text-blue-300">
                                    {task.category}
                                  </span>
                                )}
                                <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full dark:bg-green-900 dark:text-green-300">
                                  Due: {new Date(task.deadline).toLocaleDateString()}
                                </span>
                              </div>
                              <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                                <span className="flex items-center space-x-1">
                                  <Calendar size={14} />
                                  <span>{planDate}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <Clock size={14} />
                                  <span>{session.startTime} - {session.endTime}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <TrendingUp size={14} />
                                  <span>{formatTime(session.allocatedHours)}</span>
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => onSelectTask(task, { allocatedHours: session.allocatedHours, planDate, sessionNumber: session.sessionNumber })}
                                className="px-3 py-1 text-xs bg-green-100 text-green-800 rounded-lg hover:bg-green-200 transition-colors duration-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800"
                              >
                                Start Now
                              </button>
                              <button
                                onClick={() => handleSkipMissedSession(planDate, session.sessionNumber || 0, task.id)}
                                className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200 transition-colors duration-200 dark:bg-yellow-900 dark:text-yellow-200 dark:hover:bg-yellow-800"
                              >
                                Skip
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Overdue Sessions */}
                    {overdueMissedSessions.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-orange-700 dark:text-orange-300 mb-2">
                            Sessions for overdue tasks (deadline passed):
                          </h4>
                          <span className="text-xs text-orange-600 dark:text-orange-400">
                            Tasks past deadline
                          </span>
                        </div>
                        {overdueMissedSessions.map(({planDate, session, task}, idx) => (
                          <div key={`overdue-${planDate}-${session.sessionNumber || 0}-${task.id}-${session.startTime || ''}-${idx}`}
                               className="flex items-center justify-between bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-orange-200 dark:border-orange-700 hover:shadow-md transition-all duration-200">
                            <div className="flex-1">
                              <div className="flex items-center space-x-2 mb-2">
                                <BookOpen className="text-orange-500 dark:text-orange-400" size={18} />
                                <h3 className="font-medium text-gray-800 dark:text-white">{task.title}</h3>
                                {task.category && (
                                  <span className="px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded-full dark:bg-orange-900 dark:text-orange-300">
                                    {task.category}
                                  </span>
                                )}
                                <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full dark:bg-red-900 dark:text-red-300">
                                  Overdue: {new Date(task.deadline).toLocaleDateString()}
                                </span>
                              </div>
                              <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                                <span className="flex items-center space-x-1">
                                  <Calendar size={14} />
                                  <span>{planDate}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <Clock size={14} />
                                  <span>{session.startTime} - {session.endTime}</span>
                                </span>
                                <span className="flex items-center space-x-1">
                                  <TrendingUp size={14} />
                                  <span>{formatTime(session.allocatedHours)}</span>
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <button
                                onClick={() => onSelectTask(task, { allocatedHours: session.allocatedHours, planDate, sessionNumber: session.sessionNumber })}
                                className="px-3 py-1 text-xs bg-green-100 text-green-800 rounded-lg hover:bg-green-200 transition-colors duration-200 dark:bg-green-900 dark:text-green-200 dark:hover:bg-green-800"
                              >
                                Start Now
                              </button>
                              <button
                                onClick={() => handleSkipMissedSession(planDate, session.sessionNumber || 0, task.id)}
                                className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200 transition-colors duration-200 dark:bg-yellow-900 dark:text-yellow-200 dark:hover:bg-yellow-800"
                              >
                                Skip
                              </button>
                              <button
                                onClick={() => handleMarkMissedSessionDone(planDate, session.sessionNumber || 0, task.id)}
                                className="px-3 py-1 text-xs bg-purple-100 text-purple-800 rounded-lg hover:bg-purple-200 transition-colors duration-200 dark:bg-purple-900 dark:text-purple-200 dark:hover:bg-purple-800"
                                title="Mark this session as completed"
                              >
                                Mark Done
                              </button>
                              {onUpdateTask && (
                                <button
                                  onClick={() => handleMarkTaskAsCompleted(task.id)}
                                  className="px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded-lg hover:bg-blue-200 transition-colors duration-200 dark:bg-blue-900 dark:text-blue-200 dark:hover:bg-blue-800"
                                  title="Mark the entire task as completed"
                                >
                                  Mark Task Done
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* No sessions found */}
                    {missedSessions.length === 0 && overdueMissedSessions.length === 0 && (
                      <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                        <CheckCircle className="text-green-500 dark:text-green-400 mx-auto mb-2" size={24} />
                        <p>All past sessions are up to date!</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {studyPlans.length === 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6 text-center dark:bg-gray-900 dark:shadow-gray-900">
          <BookOpen size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-700" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2 dark:text-white">Ready to Get Started?</h2>
          <p className="text-gray-500 dark:text-gray-300">Add some tasks and I'll create your perfect study schedule! 🎯</p>
        </div>
      )}

      {/* Smart Assistant Modal */}
      {showSmartAssistant && suggestions.length > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                  <Lightbulb className="text-yellow-500" size={24} />
                  <span>Smart Assistant Tips</span>
                  <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full dark:bg-yellow-900 dark:text-yellow-200">
                    {suggestions.length} suggestions
                  </span>
                </h2>
                <button
                  onClick={() => setShowSmartAssistant(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="max-h-[60vh] overflow-y-auto">
                <div className="space-y-3">
                  {suggestions.map((suggestion, index) => (
                    <div key={index} className={`p-4 rounded-lg border-l-4 ${
                      suggestion.type === 'warning' ? 'border-l-red-400 bg-red-50 dark:bg-red-900/20' :
                      suggestion.type === 'celebration' ? 'border-l-green-400 bg-green-50 dark:bg-green-900/20' :
                      'border-l-blue-400 bg-blue-50 dark:bg-blue-900/20'
                    }`}>
                      <div className="flex items-start space-x-3">
                        {getSuggestionIcon(suggestion.type)}
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-800 dark:text-white mb-1">{suggestion.message}</p>
                          {suggestion.action && (
                            <p className="text-xs text-gray-600 dark:text-gray-300">
                              <span className="font-medium">💡 Tip:</span> {suggestion.action}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowSmartAssistant(false)}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                  >
                    Got it!
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudyPlanView;
