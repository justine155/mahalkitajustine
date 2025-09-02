import React, { useMemo, useState, useEffect } from 'react';
import { Calendar, momentLocalizer, Views } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { StudyPlan, FixedCommitment, Task, StudySession, UserSettings } from '../types';
import { BookOpen, Clock, Settings, X, Calendar as CalendarIcon, Brain } from 'lucide-react';
import { checkSessionStatus, doesCommitmentApplyToDate, getDaySpecificDailyHours } from '../utils/scheduling';
import { getLocalDateString } from '../utils/scheduling';
import MobileCalendarView from './MobileCalendarView';

const localizer = momentLocalizer(moment);
const DragAndDropCalendar = withDragAndDrop(Calendar);

interface CalendarViewProps {
  studyPlans: StudyPlan[];
  fixedCommitments: FixedCommitment[];
  tasks: Task[];
  settings?: UserSettings;
  onSelectTask?: (task: Task, session?: { allocatedHours: number; planDate?: string; sessionNumber?: number }) => void;
  onSelectCommitment?: (commitment: FixedCommitment, duration: number) => void;
  onStartManualSession?: (commitment: FixedCommitment, durationSeconds: number) => void;
  onDeleteFixedCommitment?: (commitmentId: string) => void;
  onUpdateCommitment?: (commitmentId: string, updates: Partial<FixedCommitment>) => void;
  onUpdateStudyPlans?: (updatedPlans: StudyPlan[]) => void;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  resource: {
    type: 'study' | 'commitment';
    data: StudySession | FixedCommitment;
    taskId?: string;
    planDate?: string; // For study sessions, which plan date they belong to
  };
}

const intervalOptions = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
];


// Removed unused constant

// Default color for commitments
const COMMITMENT_DEFAULT_COLOR = '#3b82f6'; // Blue for commitments

// Removed DEFAULT_COMMITMENT_CATEGORY_COLORS as we'll use the same color coding for tasks and commitments


const DEFAULT_MISSED_COLOR = '#dc2626'; // Darker Red
const DEFAULT_COMPLETED_COLOR = '#d1d5db'; // Gray
const DEFAULT_IMPORTANT_TASK_COLOR = '#f59e0b'; // Amber
const DEFAULT_NOT_IMPORTANT_TASK_COLOR = '#64748b'; // Gray
const DEFAULT_UNCATEGORIZED_COLOR = '#64748b'; // Gray

interface ColorSettings {
  missedColor: string;
  completedColor: string;
  importantTaskColor: string;
  notImportantTaskColor: string;
  uncategorizedTaskColor: string;
  // commitmentColor removed as commitments now use category-based colors
}

// Utility to split an event if it crosses midnight
function splitEventIfCrossesMidnight(start: Date, end: Date) {
  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate()
  ) {
    return [{ start, end }];
  } else {
    // Split into two events: one until 23:59:59, one from 00:00:00
    const endOfStartDay = new Date(start);
    endOfStartDay.setHours(23, 59, 59, 999);
    const startOfEndDay = new Date(end);
    startOfEndDay.setHours(0, 0, 0, 0);
    return [
      { start, end: endOfStartDay },
      { start: startOfEndDay, end }
    ];
  }
}

const CalendarView: React.FC<CalendarViewProps> = ({
  studyPlans,
  fixedCommitments,
  tasks,
  settings,
  onSelectTask,
  onSelectCommitment,
  onStartManualSession,
  onDeleteFixedCommitment,
  onUpdateCommitment,
  onUpdateStudyPlans,
}) => {
  const [timeInterval, setTimeInterval] = useState(() => {
    const saved = localStorage.getItem('timepilot-calendar-interval');
    if (saved) {
      const parsed = parseInt(saved);
      if ([5, 10, 15, 30, 60].includes(parsed)) {
        return parsed;
      }
    }
    return 30; // Default to 30 minutes
  });
  const [showColorSettings, setShowColorSettings] = useState(false);
  const [colorSettings, setColorSettings] = useState<ColorSettings>(() => {
    const saved = localStorage.getItem('timepilot-calendar-colors');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fallback to defaults if parsing fails
      }
    }
    return {
      missedColor: DEFAULT_MISSED_COLOR,
      completedColor: DEFAULT_COMPLETED_COLOR,
      importantTaskColor: DEFAULT_IMPORTANT_TASK_COLOR,
      notImportantTaskColor: DEFAULT_NOT_IMPORTANT_TASK_COLOR,
      uncategorizedTaskColor: DEFAULT_UNCATEGORIZED_COLOR,
    };
  });
  // Category color state with persistence
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('timepilot-category-colors');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    }
    return {};
  });

  const [selectedManualSession, setSelectedManualSession] = useState<FixedCommitment | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [currentView, setCurrentView] = useState(() => {
    const saved = localStorage.getItem('timepilot-calendar-view');
    return saved || 'week';
  });
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isDragging, setIsDragging] = useState(false);
  const [dragFeedback, setDragFeedback] = useState<string>('');
  const [showInfoModal, setShowInfoModal] = useState(false);


  // Persist calendar view to localStorage
  useEffect(() => {
    localStorage.setItem('timepilot-calendar-view', currentView);
  }, [currentView]);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Save color settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('timepilot-calendar-colors', JSON.stringify(colorSettings));
  }, [colorSettings]);

  // Persist category colors
  useEffect(() => {
    localStorage.setItem('timepilot-category-colors', JSON.stringify(categoryColors));
  }, [categoryColors]);

  // Save time interval to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('timepilot-calendar-interval', timeInterval.toString());
  }, [timeInterval]);

  const handleSpecialColorChange = (key: keyof ColorSettings, color: string) => {
    setColorSettings(prev => ({
      ...prev,
      [key]: color
    }));
  };

  const resetToDefaults = () => {
    setColorSettings({
      missedColor: DEFAULT_MISSED_COLOR,
      completedColor: DEFAULT_COMPLETED_COLOR,
      importantTaskColor: DEFAULT_IMPORTANT_TASK_COLOR,
      notImportantTaskColor: DEFAULT_NOT_IMPORTANT_TASK_COLOR,
      uncategorizedTaskColor: DEFAULT_UNCATEGORIZED_COLOR,
    });
    // Also reset category colors
    setCategoryColors({});
  };

  const events: CalendarEvent[] = useMemo(() => {
    const calendarEvents: CalendarEvent[] = [];

    // Convert study plans to calendar events
    studyPlans.forEach(plan => {
      // Filter out past incomplete sessions (forward focus approach)
      const today = getLocalDateString();
      const relevantTasks = plan.plannedTasks.filter(session => {
        // Always show sessions for today and future
        if (plan.date >= today) return true;

        // For past dates, only show completed sessions
        return session.done || session.status === 'completed' || session.status === 'skipped';
      });

      // Sort the relevant tasks by chronological order first, then by priority
      const sortedTasks = [...relevantTasks].sort((a, b) => {
        // Prioritize chronological order for manually rescheduled sessions
        // Check if either session has been manually rescheduled
        const aIsRescheduled = a.schedulingMetadata?.state === 'redistributed' || a.originalTime;
        const bIsRescheduled = b.schedulingMetadata?.state === 'redistributed' || b.originalTime;
        
        // If both are rescheduled or both are not rescheduled, sort by time
        if (aIsRescheduled === bIsRescheduled) {
          const [aH, aM] = (a.startTime || '00:00').split(':').map(Number);
          const [bH, bM] = (b.startTime || '00:00').split(':').map(Number);
          const aMinutes = aH * 60 + aM;
          const bMinutes = bH * 60 + bM;
          return aMinutes - bMinutes;
        }
        
        // If one is rescheduled and the other isn't, prioritize the rescheduled one
        if (aIsRescheduled && !bIsRescheduled) {
          return -1; // a (rescheduled) comes first
        }
        if (!aIsRescheduled && bIsRescheduled) {
          return 1; // b (rescheduled) comes first
        }
        
        // Fallback to time-based sorting
        const [aH, aM] = (a.startTime || '00:00').split(':').map(Number);
        const [bH, bM] = (b.startTime || '00:00').split(':').map(Number);
        const aMinutes = aH * 60 + aM;
        const bMinutes = bH * 60 + bM;
        return aMinutes - bMinutes;
      });

      sortedTasks.forEach(session => {
        const task = tasks.find(t => t.id === session.taskId);
        if (!task) return;

        const planDate = plan.date; // Always set planDate explicitly
        const startDateTime = new Date(planDate);
        const [startHour, startMinute] = session.startTime.split(':').map(Number);
        startDateTime.setHours(startHour, startMinute, 0, 0);
        const endDateTime = new Date(planDate);
        const [endHour, endMinute] = session.endTime.split(':').map(Number);
        endDateTime.setHours(endHour, endMinute, 0, 0);

        // Split if crosses midnight
        splitEventIfCrossesMidnight(startDateTime, endDateTime).forEach(({ start, end }, idx) => {
          // Create a more unique ID that includes session number and start time to prevent duplicates
          const uniqueId = `study-${session.taskId}-${plan.date}-${session.sessionNumber || 0}-${session.startTime.replace(':', '')}-${idx}`;
          calendarEvents.push({
            id: uniqueId,
            title: task.title,
            start,
            end,
            resource: {
              type: 'study',
              data: session,
              planDate // Always include planDate
            }
          });
        });
      });
    });

    // Convert fixed commitments to calendar events
    fixedCommitments.forEach(commitment => {
      if (commitment.recurring) {
        // Handle recurring commitments
        const today = new Date();
        // Default end date is 1 year from today
        let endDate = new Date();
        endDate.setDate(today.getDate() + 365);
        
        // Declare currentDate variable before the if-else block
        let currentDate: Date;
        
        // If dateRange is specified, use it instead
        if (commitment.dateRange?.startDate && commitment.dateRange?.endDate) {
          // Use the later of today or startDate as the beginning date
          const rangeStartDate = new Date(commitment.dateRange.startDate);
          const startDate = rangeStartDate > today ? rangeStartDate : today;
          endDate = new Date(commitment.dateRange.endDate);
          
          // If the range is in the past, skip this commitment
          if (endDate < today) {
            return;
          }
          
          // Update the current date to start from the range start
          currentDate = new Date(startDate);
        } else {
          // No date range specified, use default 1-year range
          endDate.setDate(today.getDate() + 365);
          currentDate = new Date(today);
        }
        // Add one day to endDate to include the full last day
        const inclusiveEndDate = new Date(endDate);
        inclusiveEndDate.setDate(inclusiveEndDate.getDate() + 1);
        while (currentDate < inclusiveEndDate) {
          if (commitment.daysOfWeek.includes(currentDate.getDay())) {
            const dateString = currentDate.toISOString().split('T')[0];
            
            // Skip deleted occurrences
            if (commitment.deletedOccurrences?.includes(dateString)) {
              currentDate.setDate(currentDate.getDate() + 1);
              continue;
            }
            
            // Check for modified occurrence
            const modifiedSession = commitment.modifiedOccurrences?.[dateString];

            // Get day-specific timing if available
            const dayOfWeek = currentDate.getDay();
            const daySpecificTiming = commitment.useDaySpecificTiming
              ? commitment.daySpecificTimings?.find(t => t.dayOfWeek === dayOfWeek)
              : null;

            // Determine if this is an all-day event (priority: modified > day-specific > general)
            let isAllDay: boolean;
            if (modifiedSession?.isAllDay !== undefined) {
              isAllDay = modifiedSession.isAllDay;
            } else if (daySpecificTiming?.isAllDay !== undefined) {
              isAllDay = daySpecificTiming.isAllDay;
            } else {
              isAllDay = commitment.isAllDay || false;
            }

            let startDateTime = new Date(currentDate);
            let endDateTime = new Date(currentDate);

            if (isAllDay) {
              // For all-day events, set time to 00:00:00 for start and 23:59:59 for end
              startDateTime.setHours(0, 0, 0, 0);
              endDateTime.setHours(23, 59, 59, 999);
            } else {
              // For time-specific events, use the specified times (priority: modified > day-specific > general)
              let startTime: string;
              let endTime: string;

              if (modifiedSession?.startTime && modifiedSession?.endTime) {
                startTime = modifiedSession.startTime;
                endTime = modifiedSession.endTime;
              } else if (daySpecificTiming?.startTime && daySpecificTiming?.endTime) {
                startTime = daySpecificTiming.startTime;
                endTime = daySpecificTiming.endTime;
              } else {
                startTime = commitment.startTime || '00:00';
                endTime = commitment.endTime || '23:59';
              }

              const [startHour, startMinute] = startTime.split(':').map(Number);
              startDateTime.setHours(startHour, startMinute, 0, 0);
              const [endHour, endMinute] = endTime.split(':').map(Number);
              endDateTime.setHours(endHour, endMinute, 0, 0);
            }
            
            // Split if crosses midnight
            splitEventIfCrossesMidnight(startDateTime, endDateTime).forEach(({ start, end }, idx) => {
              const uniqueId = `commitment-${commitment.id}-${currentDate.toISOString().split('T')[0]}-${(modifiedSession?.startTime || commitment.startTime || '00:00').replace(':', '')}-${idx}`;
              calendarEvents.push({
                id: uniqueId,
                title: modifiedSession?.title || commitment.title,
                start,
                end,
                allDay: isAllDay,
                resource: {
                  type: 'commitment',
                  data: {
                    ...commitment,
                    title: modifiedSession?.title || commitment.title,
                    startTime: modifiedSession?.startTime || commitment.startTime,
                    endTime: modifiedSession?.endTime || commitment.endTime,
                    category: modifiedSession?.category || commitment.category,
                    isAllDay: isAllDay
                  }
                }
              });
            });
          }
          currentDate.setDate(currentDate.getDate() + 1);
        }
      } else {
        // Handle non-recurring commitments
        commitment.specificDates?.forEach(dateString => {
          // Skip deleted occurrences
          if (commitment.deletedOccurrences?.includes(dateString)) {
            return;
          }
          
          const currentDate = new Date(dateString);
          
          // Check for modified occurrence
          const modifiedSession = commitment.modifiedOccurrences?.[dateString];

          // Get day-specific timing if available (for non-recurring commitments on specific days)
          const dayOfWeek = currentDate.getDay();
          const daySpecificTiming = commitment.useDaySpecificTiming
            ? commitment.daySpecificTimings?.find(t => t.dayOfWeek === dayOfWeek)
            : null;

          // Determine if this is an all-day event (priority: modified > day-specific > general)
          let isAllDay: boolean;
          if (modifiedSession?.isAllDay !== undefined) {
            isAllDay = modifiedSession.isAllDay;
          } else if (daySpecificTiming?.isAllDay !== undefined) {
            isAllDay = daySpecificTiming.isAllDay;
          } else {
            isAllDay = commitment.isAllDay || false;
          }

          let startDateTime = new Date(currentDate);
          let endDateTime = new Date(currentDate);

          if (isAllDay) {
            // For all-day events, set time to 00:00:00 for start and 23:59:59 for end
            startDateTime.setHours(0, 0, 0, 0);
            endDateTime.setHours(23, 59, 59, 999);
          } else {
            // For time-specific events, use the specified times (priority: modified > day-specific > general)
            let startTime: string;
            let endTime: string;

            if (modifiedSession?.startTime && modifiedSession?.endTime) {
              startTime = modifiedSession.startTime;
              endTime = modifiedSession.endTime;
            } else if (daySpecificTiming?.startTime && daySpecificTiming?.endTime) {
              startTime = daySpecificTiming.startTime;
              endTime = daySpecificTiming.endTime;
            } else {
              startTime = commitment.startTime || '00:00';
              endTime = commitment.endTime || '23:59';
            }

            const [startHour, startMinute] = startTime.split(':').map(Number);
            startDateTime.setHours(startHour, startMinute, 0, 0);
            const [endHour, endMinute] = endTime.split(':').map(Number);
            endDateTime.setHours(endHour, endMinute, 0, 0);
          }
          
          // Split if crosses midnight
          splitEventIfCrossesMidnight(startDateTime, endDateTime).forEach(({ start, end }, idx) => {
            const uniqueId = `commitment-${commitment.id}-${dateString}-${(modifiedSession?.startTime || commitment.startTime || '00:00').replace(':', '')}-${idx}`;
            calendarEvents.push({
              id: uniqueId,
              title: modifiedSession?.title || commitment.title,
              start,
              end,
              allDay: isAllDay,
              resource: {
                type: 'commitment',
                data: {
                  ...commitment,
                  title: modifiedSession?.title || commitment.title,
                  startTime: modifiedSession?.startTime || commitment.startTime,
                  endTime: modifiedSession?.endTime || commitment.endTime,
                  category: modifiedSession?.category || commitment.category,
                  isAllDay: isAllDay
                }
              }
            });
          });
        });
      }
    });

    return calendarEvents;
  }, [studyPlans, fixedCommitments, tasks]);

  // Get all unique task categories
  const taskCategories = Array.from(new Set(tasks.map(t => t.category).filter((v): v is string => !!v)));
  
  // Define all default categories with their colors
  const defaultCategories = ['Academics', 'Personal', 'Learning', 'Home', 'Finance', 'Organization', 'Work', 'Health', 'Routine'];
  
  // Assign color to each category with specific defaults
  const categoryColorMap: Record<string, string> = {};
  
  // Initialize all default categories with their colors (saved or default)
  defaultCategories.forEach((category) => {
    // Check if user has a custom color for this category
    if (categoryColors[category]) {
      categoryColorMap[category] = categoryColors[category];
    } else {
      // Use default colors
      switch (category.toLowerCase()) {
        case 'academics':
          categoryColorMap[category] = '#3b82f6'; // Blue
          break;
        case 'personal':
          categoryColorMap[category] = '#a21caf'; // Purple
          break;
        case 'learning':
          categoryColorMap[category] = '#a855f7'; // Lavender
          break;
        case 'home':
          categoryColorMap[category] = '#f472b6'; // Light pink
          break;
        case 'finance':
          categoryColorMap[category] = '#10b981'; // Green
          break;
        case 'organization':
          categoryColorMap[category] = '#eab308'; // Yellow
          break;
        case 'work':
          categoryColorMap[category] = '#f59e0b'; // Orange
          break;
        case 'health':
          categoryColorMap[category] = '#ef4444'; // Red
          break;
        case 'routine':
          categoryColorMap[category] = '#6366f1'; // Indigo
          break;
        default:
          categoryColorMap[category] = '#64748b'; // Default gray
      }
    }
  });
  
  // Map any custom categories from tasks that aren't in the default list to uncategorized color
  taskCategories.forEach((category) => {
    if (!defaultCategories.includes(category)) {
      // Use uncategorized color for unknown categories instead of creating new legend entries
      categoryColorMap[category] = colorSettings.uncategorizedTaskColor;
    }
  });

  const handleSelectEvent = (event: CalendarEvent) => {
    if (event.resource.type === 'study') {
      const session = event.resource.data as StudySession;
      // Prevent clicking on done sessions
      if (session.done) return;
      const today = getLocalDateString();
      // Always use planDate from event.resource, fallback to event.start if missing
      let planDate = event.resource.planDate;
      if (!planDate && event.start) {
        planDate = event.start.toISOString().split('T')[0];
      }
      if ((planDate === today)) {
        if (onSelectTask) {
          onSelectTask(tasks.find(t => t.id === session.taskId)!, {
            allocatedHours: moment(event.end).diff(moment(event.start), 'hours', true),
            planDate: planDate,
            sessionNumber: session.sessionNumber
          });
        }
      }
      // Otherwise, do nothing (not clickable)
    } else if (event.resource.type === 'commitment') {
      const commitment = event.resource.data as FixedCommitment;
      const today = getLocalDateString();
      const commitmentDate = moment(event.start).format('YYYY-MM-DD');

      // Check if this is a manual rescheduled session
      if (commitment.title.includes('(Manual Resched)')) {
        setSelectedManualSession(commitment);
      } else if (commitment.countsTowardDailyHours && onSelectCommitment && commitmentDate === today) {
        // Handle clicks on commitments that count toward daily hours - only for current day
        const duration = moment(event.end).diff(moment(event.start), 'hours', true);
        onSelectCommitment(commitment, duration);
      }
      // Otherwise, do nothing (not clickable for non-current days)
    }
  };

  // Utility function to find available time slots with precise placement
  const findNearestAvailableSlot = (targetStart: Date, sessionDuration: number, targetDate: string, excludeSession?: any): { start: Date; end: Date } | null => {
    if (!settings) return null;

    // Get all busy slots for the target date
    const busySlots: Array<{ start: Date; end: Date }> = [];

    // Add existing study sessions
    studyPlans.forEach(plan => {
      if (plan.date === targetDate) {
        plan.plannedTasks.forEach(session => {
          // Exclude the session being dragged to avoid self-overlap detection
          if (excludeSession &&
              session.taskId === excludeSession.taskId &&
              session.sessionNumber === excludeSession.sessionNumber) {
            return;
          }

          if (session.status !== 'skipped' && session.startTime && session.endTime) {
            const sessionStart = moment(targetDate + ' ' + session.startTime).toDate();
            const sessionEnd = moment(targetDate + ' ' + session.endTime).toDate();
            busySlots.push({ start: sessionStart, end: sessionEnd });
          }
        });
      }
    });

    // Add fixed commitments
    fixedCommitments.forEach(commitment => {
      if (doesCommitmentApplyToDate(commitment, targetDate) && commitment.startTime && commitment.endTime) {
        const commitmentStart = moment(targetDate + ' ' + commitment.startTime).toDate();
        const commitmentEnd = moment(targetDate + ' ' + commitment.endTime).toDate();
        busySlots.push({ start: commitmentStart, end: commitmentEnd });
      }
    });

    // Sort busy slots by start time
    busySlots.sort((a, b) => a.start.getTime() - b.start.getTime());

    // Set study window boundaries
    const dayStart = moment(targetDate).hour(settings.studyWindowStartHour || 6).minute(0).second(0).toDate();
    const dayEnd = moment(targetDate).hour(settings.studyWindowEndHour || 23).minute(0).second(0).toDate();

    const sessionDurationMs = sessionDuration * 60 * 60 * 1000;
    const bufferTimeMs = (settings.bufferTimeBetweenSessions || 0) * 60 * 1000; // Convert minutes to ms

    // Function to check if a slot is valid
    const isSlotValid = (slotStart: Date, slotEnd: Date) => {
      // Check if within study window
      if (slotStart < dayStart || slotEnd > dayEnd) return false;

      // Check if it conflicts with any busy slot
      for (const busySlot of busySlots) {
        const adjustedStart = new Date(slotStart.getTime() - bufferTimeMs);
        const adjustedEnd = new Date(slotEnd.getTime() + bufferTimeMs);

        if (adjustedStart < busySlot.end && adjustedEnd > busySlot.start) {
          return false;
        }
      }
      return true;
    };

    // IMPROVED: Try to place at exact target time first, then snap if needed
    const SNAP_INTERVAL = timeInterval * 60 * 1000; // Convert user's time interval to milliseconds

    // First, try the exact drop position without snapping
    const exactTargetEnd = new Date(targetStart.getTime() + sessionDurationMs);
    if (isSlotValid(targetStart, exactTargetEnd)) {
      return { start: targetStart, end: exactTargetEnd };
    }

    // If exact position doesn't work, try snapped to grid
    const roundedTarget = new Date(Math.round(targetStart.getTime() / SNAP_INTERVAL) * SNAP_INTERVAL);
    const targetEnd = new Date(roundedTarget.getTime() + sessionDurationMs);

    if (isSlotValid(roundedTarget, targetEnd)) {
      return { start: roundedTarget, end: targetEnd };
    }

    // If exact location doesn't work, search for nearest alternative
    // Search in time interval increments for consistent grid placement
    const maxSearchTime = 6 * 60 * 60 * 1000; // Search within 6 hours (reduced from 12)

    for (let offset = SNAP_INTERVAL; offset <= maxSearchTime; offset += SNAP_INTERVAL) {
      // Try both directions from target time, but prioritize forward direction first
      const directions = [1, -1];

      for (const direction of directions) {
        const testStart = new Date(roundedTarget.getTime() + (direction * offset));
        const testEnd = new Date(testStart.getTime() + sessionDurationMs);

        if (isSlotValid(testStart, testEnd)) {
          return { start: testStart, end: testEnd };
        }
      }
    }

    return null;
  };

  // Handle drag start
  const handleDragStart = (event: any) => {
    setIsDragging(true);
    setDragFeedback('');

    // Store the original position for comparison
    if (event && event.start) {
      const originalTime = moment(event.start).format('HH:mm');
      setDragFeedback(`Dragging session from ${originalTime}...`);
    }
  };

  // Handle event drop
  const handleEventDrop = ({ event, start, end }: { event: CalendarEvent; start: Date; end: Date }) => {
    setIsDragging(false);

    // Handle commitment dragging
    if (event.resource.type === 'commitment') {
      const commitment = event.resource.data as FixedCommitment;

      // Only allow dragging commitments that count toward daily hours
      if (!commitment.countsTowardDailyHours) {
        setDragFeedback('Only productive commitments can be moved');
        setTimeout(() => setDragFeedback(''), 3000);
        return;
      }

      if (!onUpdateCommitment) {
        setDragFeedback('Commitment updates not available');
        setTimeout(() => setDragFeedback(''), 3000);
        return;
      }

      const targetDate = moment(start).format('YYYY-MM-DD');
      const newStartTime = moment(start).format('HH:mm');
      const newEndTime = moment(end).format('HH:mm');
      const dayOfWeek = moment(start).day();

      // For recurring commitments with day-specific timing, only modify this specific date
      if (commitment.recurring && commitment.useDaySpecificTiming) {
        // Create a modified occurrence for this specific date only - don't change future days
        const updatedModifiedOccurrences = {
          ...commitment.modifiedOccurrences,
          [targetDate]: {
            startTime: newStartTime,
            endTime: newEndTime,
            title: commitment.title,
            category: commitment.category,
            isAllDay: false
          }
        };

        onUpdateCommitment(commitment.id, {
          modifiedOccurrences: updatedModifiedOccurrences
        });

        setDragFeedback(`✅ Commitment moved to ${newStartTime} - ${newEndTime} on ${moment(targetDate).format('MMM D')} only`);
        setTimeout(() => setDragFeedback(''), 3000);
        return;
      }

      // For one-time commitments, create a modified occurrence instead of updating base times
      if (!commitment.recurring && commitment.specificDates?.includes(targetDate)) {
        const updatedModifiedOccurrences = {
          ...commitment.modifiedOccurrences,
          [targetDate]: {
            startTime: newStartTime,
            endTime: newEndTime,
            title: commitment.title,
            category: commitment.category,
            isAllDay: false
          }
        };

        onUpdateCommitment(commitment.id, {
          modifiedOccurrences: updatedModifiedOccurrences
        });

        setDragFeedback(`✅ Commitment moved to ${newStartTime} - ${newEndTime} on ${moment(targetDate).format('MMM D')}`);
        setTimeout(() => setDragFeedback(''), 3000);
        return;
      }

      // For recurring commitments without day-specific timing, create a modified occurrence for this specific date
      if (commitment.recurring) {
        const updatedModifiedOccurrences = {
          ...commitment.modifiedOccurrences,
          [targetDate]: {
            startTime: newStartTime,
            endTime: newEndTime,
            title: commitment.title,
            category: commitment.category,
            isAllDay: false
          }
        };

        onUpdateCommitment(commitment.id, {
          modifiedOccurrences: updatedModifiedOccurrences
        });

        setDragFeedback(`✅ Commitment moved to ${newStartTime} - ${newEndTime} on ${moment(targetDate).format('MMM D')}`);
        setTimeout(() => setDragFeedback(''), 3000);
        return;
      }

      setDragFeedback('Unable to update this commitment type');
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    // Only allow dragging study sessions if not a commitment
    if (event.resource.type !== 'study' || !onUpdateStudyPlans || !settings) {
      setDragFeedback('Only study sessions and productive commitments can be moved');
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    const session = event.resource.data as StudySession;
    const targetDate = moment(start).format('YYYY-MM-DD');
    const originalDate = event.resource.planDate || moment(event.start).format('YYYY-MM-DD');
    const sessionDuration = session.allocatedHours;

    // Check session status for restrictions
    const sessionStatus = checkSessionStatus(session, originalDate);

    // Restrict movement to same day only
    if (targetDate !== originalDate) {
      setDragFeedback('Sessions can only be moved within the same day');
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    // Check if target day is a work day (keeping this for consistency)
    const targetDayOfWeek = moment(start).day();
    if (!settings.workDays.includes(targetDayOfWeek)) {
      setDragFeedback(`Cannot move session to ${moment(start).format('dddd')} - not a work day`);
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    // Find the nearest available slot, excluding the session being dragged
    const availableSlot = findNearestAvailableSlot(start, sessionDuration, targetDate, session);

    if (!availableSlot) {
      setDragFeedback('No available time slot found for this session');
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    // Check for micro-movements - if user drops very close to original position, keep it there
    const originalStartTime = moment(originalDate + ' ' + session.startTime).toDate();
    const timeDifferenceFromOriginal = Math.abs(moment(start).diff(moment(originalStartTime), 'minutes'));

    // If the movement is less than 2 minutes, consider it a micro-movement and ignore
    if (timeDifferenceFromOriginal < 2) {
      setDragFeedback('Session kept in original position');
      setTimeout(() => setDragFeedback(''), 2000);
      return;
    }

    // Calculate the time difference to inform user if session was moved
    const actualTime = moment(availableSlot.start).format('HH:mm');
    const timeDifferenceMinutes = Math.abs(moment(availableSlot.start).diff(moment(start), 'minutes'));

    // Provide specific feedback about placement
    let placementMessage = '';
    if (timeDifferenceMinutes === 0) {
      placementMessage = `✅ Session placed exactly at ${actualTime}`;
    } else if (timeDifferenceMinutes <= 15) {
      placementMessage = `📍 Session placed at ${actualTime} (${timeDifferenceMinutes}min from target)`;
    } else {
      placementMessage = `🔄 Session moved to ${actualTime} (nearest available slot)`;
    }

    // Get the original plan date where the session was dragged from
    const originalPlanDate = event.resource.planDate;

    // Update the study plans
    const updatedPlans = studyPlans.map(plan => {
      if (plan.date === targetDate) {
        // Add session to target date
        const newSession = {
          ...session,
          startTime: moment(availableSlot.start).format('HH:mm'),
          endTime: moment(availableSlot.end).format('HH:mm'),
          originalTime: session.originalTime || session.startTime,
          originalDate: session.originalDate || originalPlanDate,
          rescheduledAt: new Date().toISOString(),
          isManualOverride: true
        };

        // Check if session already exists in this plan
        const existingSessionIndex = plan.plannedTasks.findIndex(s =>
          s.taskId === session.taskId && s.sessionNumber === session.sessionNumber
        );

        if (existingSessionIndex >= 0) {
          // Update existing session
          const updatedTasks = [...plan.plannedTasks];
          updatedTasks[existingSessionIndex] = newSession;
          return { ...plan, plannedTasks: updatedTasks };
        } else {
          // Add new session
          return {
            ...plan,
            plannedTasks: [...plan.plannedTasks, newSession]
          };
        }
      } else if (plan.date === originalPlanDate) {
        // Remove session ONLY from the original plan date (where it was dragged from)
        const updatedTasks = plan.plannedTasks.filter(s =>
          !(s.taskId === session.taskId && s.sessionNumber === session.sessionNumber)
        );
        return { ...plan, plannedTasks: updatedTasks };
      } else {
        // For all other plans, leave them unchanged
        return plan;
      }
    });

    // If target date doesn't exist in plans, create it
    const targetPlanExists = updatedPlans.some(plan => plan.date === targetDate);
    if (!targetPlanExists) {
      const newSession = {
        ...session,
        startTime: moment(availableSlot.start).format('HH:mm'),
        endTime: moment(availableSlot.end).format('HH:mm'),
        originalTime: session.originalTime || session.startTime,
        originalDate: session.originalDate || originalPlanDate,
        rescheduledAt: new Date().toISOString(),
        isManualOverride: true
      };

      updatedPlans.push({
        id: `plan-${targetDate}`,
        date: targetDate,
        plannedTasks: [newSession],
        totalStudyHours: sessionDuration,
        isOverloaded: false,
        availableHours: getDaySpecificDailyHours(newPlanDate, settings)
      });

      // Also remove from original plan if it exists
      const originalPlanIndex = updatedPlans.findIndex(plan => plan.date === originalPlanDate);
      if (originalPlanIndex >= 0) {
        const originalPlan = updatedPlans[originalPlanIndex];
        const updatedOriginalTasks = originalPlan.plannedTasks.filter(s =>
          !(s.taskId === session.taskId && s.sessionNumber === session.sessionNumber)
        );
        updatedPlans[originalPlanIndex] = { ...originalPlan, plannedTasks: updatedOriginalTasks };
      }
    }

    onUpdateStudyPlans(updatedPlans);

    // Show the placement feedback message
    setDragFeedback(placementMessage);
    setTimeout(() => setDragFeedback(''), 4000); // Show for 4 seconds
  };



  // Custom event style for modern look, now color-coded by priority or type
  const eventStyleGetter = (event: CalendarEvent, start: Date, _end: Date, isSelected: boolean) => {
    let backgroundColor = COMMITMENT_DEFAULT_COLOR;
    let opacity = 0.95;
    let display = 'block';
    let textDecoration = 'none';
    let backgroundImage = 'none';
    let backgroundSize = 'auto';
    
    if (event.resource.type === 'study') {
      const session = event.resource.data as StudySession;
      // Find the task for this session
      const task = tasks.find(t => t.id === session.taskId);
      
      // Use category-based colors for study tasks
      if (task?.category && categoryColorMap[task.category]) {
        backgroundColor = categoryColorMap[task.category];
      } else {
        backgroundColor = colorSettings.uncategorizedTaskColor;
      }
      
      // Check session status
      const sessionStatus = checkSessionStatus(session, moment(start).format('YYYY-MM-DD'));
      
      // Debug logging for session status
      console.log(`Calendar event "${event.title}" on ${moment(start).format('YYYY-MM-DD')}: status=${sessionStatus}, done=${session.done}, startTime=${session.startTime}, endTime=${session.endTime}`);
      
      // Hide skipped sessions from calendar
      if (session.status === 'skipped') {
        display = 'none';
        opacity = 0;
      }
      // If session is done, gray it out
      else if (session.done || sessionStatus === 'completed') {
        backgroundColor = colorSettings.completedColor;
        opacity = 0.5;
      }

    } else if (event.resource.type === 'commitment') {
      const commitment = event.resource.data as FixedCommitment;
      // Use category-based colors for commitments, same as tasks
      if (commitment.category && categoryColorMap[commitment.category]) {
        backgroundColor = categoryColorMap[commitment.category];
      } else {
        backgroundColor = colorSettings.uncategorizedTaskColor;
      }

      // Special case for buffer category
      if (commitment.category === 'Buffer') {
        // Make buffer commitments invisible but still block time
        backgroundColor = 'transparent';
        opacity = 0;
        display = 'none';
      }
    }
    // Add visual indicators for task importance
    let borderStyle = 'none';
    
    if (event.resource.type === 'study') {
      const session = event.resource.data as StudySession;
      const task = tasks.find(t => t.id === session.taskId);
      if (task && !task.importance && backgroundImage === 'none') {
        // Add more visible dot pattern for not important tasks (only if no other pattern is set)
        backgroundImage = 'radial-gradient(circle, rgba(255,255,255,0.25) 1.5px, transparent 1.5px)';
        backgroundSize = '6px 6px';
      }
      // Important tasks get no texture (clean look)
    }
    
    // Handle selection with border only
    if (isSelected) {
      borderStyle = '3px solid #a21caf';
    }
    
    return {
      style: {
        backgroundColor,
        borderRadius: '12px',
        color: '#fff',
        border: borderStyle,
        backgroundImage,
        backgroundSize: backgroundImage !== 'none' ? backgroundSize : 'auto',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        fontWeight: 500,
        fontSize: '0.95em',
        padding: '2px 8px',
        opacity,
        display,
        textDecoration,
      }
    };
  };

  // Function to get emoji for task category
  const getCategoryEmoji = (category?: string): string => {
    if (!category) return '';
    
    const categoryLower = category.toLowerCase();
    
    // Map categories to emojis
    switch (categoryLower) {
      case 'academics':
        return '📚';
      case 'org':
      case 'organization':
        return '🏢';
      case 'work':
        return '💼';
      case 'personal':
        return '👤';
      case 'health':
        return '🏥';
      case 'learning':
        return '🎯';
      case 'finance':
        return '💰';
      case 'home':
        return '🏠';
      default:
        // For custom categories, try to match common words
        if (categoryLower.includes('study') || categoryLower.includes('school') || categoryLower.includes('class')) {
          return '���';
        } else if (categoryLower.includes('work') || categoryLower.includes('job') || categoryLower.includes('business')) {
          return '💼';
        } else if (categoryLower.includes('health') || categoryLower.includes('medical') || categoryLower.includes('fitness')) {
          return '��';
        } else if (categoryLower.includes('finance') || categoryLower.includes('money') || categoryLower.includes('budget')) {
          return '💰';
        } else if (categoryLower.includes('home') || categoryLower.includes('house') || categoryLower.includes('family')) {
          return '🏠';
        } else if (categoryLower.includes('personal') || categoryLower.includes('life')) {
          return '👤';
        } else {
          return '📋'; // Default for unknown categories
        }
    }
  };

  // Custom time gutter style
  const customGutterHeader = (date: Date) => moment(date).format('HH:mm');

  // Custom event component with category emoji
  const CustomEventComponent = ({
    event,
    continuesPrior,
    continuesAfter,
    isAllDay,
    slotStart,
    slotEnd,
    ...props
  }: any) => {
          let categoryEmoji = '';
      let statusIndicator = '';
      let duration = '';

      // Calculate duration more accurately, but hide for all-day commitments
      if (!isAllDay || event.resource.type === 'study') {
        const durationMs = moment(event.end).diff(moment(event.start));
        const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
        const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

        if (durationHours >= 1) {
          if (durationMinutes > 0) {
            duration = `(${durationHours}h ${durationMinutes}m)`;
          } else {
            duration = `(${durationHours}h)`;
          }
        } else {
          duration = `(${durationMinutes}m)`;
        }
      }

      if (event.resource.type === 'study') {
      const task = event.resource.data.task;
      categoryEmoji = getCategoryEmoji(task?.category);

      // Check session status
      const sessionStatus = checkSessionStatus(event.resource.data, moment(event.start).format('YYYY-MM-DD'));

      // Debug logging for calendar event status
      console.log(`Calendar event "${event.title}" status: ${sessionStatus}, indicator: ${statusIndicator}`);
    } else if (event.resource.type === 'commitment') {
      const commitment = event.resource.data as FixedCommitment;
      // For commitments, use the same category emoji system as tasks
      categoryEmoji = getCategoryEmoji(commitment.category);
    }

    return (
      <div className="relative w-full h-full">
        {/* Main event content with emoji */}
        <div className="w-full h-full flex items-start justify-center text-center px-1 py-1 pt-1">
          <div className="flex items-center gap-1">
            {categoryEmoji && (
              <span className="text-sm">{categoryEmoji}</span>
            )}
                          <span className="text-sm font-medium leading-tight">
                {event.title} {duration}
              </span>
            {statusIndicator && (
              <span className="text-xs ml-1">{statusIndicator}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Custom toolbar for interval selector
  function CustomToolbar({ label, onNavigate, onView, view }: any) {
    const handleViewChange = (newView: string) => {
      setCurrentView(newView);
      if (newView !== 'agenda') {
        onView(newView);
      }
    };

    const handleNavigate = (action: string) => {
      if (currentView === 'agenda') {
        const newDate = new Date(currentDate);
        if (action === 'PREV') {
          newDate.setDate(newDate.getDate() - 7);
        } else if (action === 'NEXT') {
          newDate.setDate(newDate.getDate() + 7);
        }
        setCurrentDate(newDate);
      } else {
        onNavigate(action);
      }
    };

    const getLabel = () => {
      if (currentView === 'agenda') {
        const endDate = new Date(currentDate);
        endDate.setDate(endDate.getDate() + 6);
        return `${moment(currentDate).format('MMM D')} - ${moment(endDate).format('MMM D, YYYY')}`;
      }
      return label;
    };

    return (
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <button onClick={() => handleNavigate('PREV')} className="rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-800">
            <span className="sr-only">Previous</span>
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="font-semibold text-lg text-gray-800 dark:text-gray-100">{getLabel()}</span>
          <button onClick={() => handleNavigate('NEXT')} className="rounded-full p-2 hover:bg-gray-100 dark:hover:bg-gray-800">
            <span className="sr-only">Next</span>
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        <div className="flex items-center space-x-2">
          {currentView !== 'agenda' && (
            <select
              value={timeInterval}
              onChange={e => setTimeInterval(Number(e.target.value))}
              className="border rounded-lg px-2 py-1 text-sm shadow-sm focus:ring-2 focus:ring-blue-400 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
              style={{ minWidth: 80 }}
            >
              {intervalOptions.map(opt => (
                <option key={opt.value} value={opt.value} className="dark:bg-gray-800 dark:text-gray-100">{opt.label}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => handleViewChange('day')}
            className={`px-2 py-1 rounded-lg text-sm font-medium ${currentView === 'day' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >Day</button>
          <button
            onClick={() => handleViewChange('week')}
            className={`px-2 py-1 rounded-lg text-sm font-medium ${currentView === 'week' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >Week</button>
          <button
            onClick={() => handleViewChange('month')}
            className={`px-2 py-1 rounded-lg text-sm font-medium ${currentView === 'month' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >Month</button>
          <button
            onClick={() => handleViewChange('agenda')}
            className={`px-2 py-1 rounded-lg text-sm font-medium ${currentView === 'agenda' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
          >Agenda</button>
        </div>
      </div>
    );
  }

  // Helper function to convert time string to minutes for sorting
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };

  // Custom Agenda Component
  const CustomAgenda = () => {
    const agendaEvents = useMemo(() => {
      const startDate = new Date(currentDate);
      const endDate = new Date(currentDate);
      endDate.setDate(endDate.getDate() + 6);

      const agendaItems: Array<{
        date: Date;
        time: string;
        title: string;
        type: 'study' | 'commitment';
        color: string;
        id: string;
      }> = [];

      // Get study sessions
      studyPlans.forEach(plan => {
        const planDate = new Date(plan.date);
        if (planDate >= startDate && planDate <= endDate) {
          plan.plannedTasks
            .filter(session => session.status !== 'skipped')
            .forEach(session => {
              const task = tasks.find(t => t.id === session.taskId);
              if (task && session.startTime && session.endTime) {
                const sessionStatus = checkSessionStatus(session, plan.date);
                let color = '#64748b'; // Default gray

                if (sessionStatus === 'completed' || session.done) {
                  color = colorSettings.completedColor;
                } else if (sessionStatus === 'missed') {
                  color = colorSettings.missedColor;
                } else if (task.importance) {
                  color = colorSettings.importantTaskColor;
                } else {
                  color = colorSettings.notImportantTaskColor;
                }

                agendaItems.push({
                  date: planDate,
                  time: `${session.startTime} - ${session.endTime}`,
                  title: task.title,
                  type: 'study',
                  color,
                  id: `study-${session.taskId}-${session.sessionNumber}`
                });
              }
            });
        }
      });

      // Get commitments - fix date iteration bug
      let currentDay = new Date(startDate);
      while (currentDay <= endDate) {
        const dayString = currentDay.toISOString().split('T')[0];
        fixedCommitments.forEach(commitment => {
          if (doesCommitmentApplyToDate(commitment, dayString)) {
            const color = categoryColors[commitment.category] || COMMITMENT_DEFAULT_COLOR;
            agendaItems.push({
              date: new Date(currentDay),
              time: `${commitment.startTime} - ${commitment.endTime}`,
              title: commitment.title,
              type: 'commitment',
              color,
              id: `commitment-${commitment.id}-${dayString}`
            });
          }
        });
        currentDay = new Date(currentDay);
        currentDay.setDate(currentDay.getDate() + 1);
      }

      // Sort by date and time
      agendaItems.sort((a, b) => {
        const dateCompare = a.date.getTime() - b.date.getTime();
        if (dateCompare !== 0) return dateCompare;

        // Convert time strings to minutes for proper sorting
        const aTime = a.time.split(' - ')[0];
        const bTime = b.time.split(' - ')[0];

        const aMinutes = timeToMinutes(aTime);
        const bMinutes = timeToMinutes(bTime);

        return aMinutes - bMinutes;
      });

      return agendaItems;
    }, [studyPlans, fixedCommitments, tasks, currentDate, colorSettings, categoryColors]);

    const groupedEvents = useMemo(() => {
      const groups: Record<string, typeof agendaEvents> = {};
      agendaEvents.forEach(event => {
        const dateKey = moment(event.date).format('YYYY-MM-DD');
        if (!groups[dateKey]) {
          groups[dateKey] = [];
        }
        groups[dateKey].push(event);
      });
      return groups;
    }, [agendaEvents]);

    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700 max-h-[600px] overflow-y-auto">
        {Object.keys(groupedEvents).length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No events scheduled for this week
          </div>
        ) : (
          Object.entries(groupedEvents).map(([dateKey, events]) => (
            <div key={dateKey} className="border-b dark:border-gray-700 last:border-b-0">
              <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 sticky top-0">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  {moment(dateKey).format('ddd MMM D')}
                </h3>
              </div>
              <div className="divide-y dark:divide-gray-700">
                {events.map(event => (
                  <div key={event.id} className={`flex items-center p-3 hover:bg-gray-50 dark:hover:bg-gray-700 ${
                    event.type === 'commitment' ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''
                  }`}>
                    <div className="flex-shrink-0 w-16 text-right">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {event.time.split(' - ')[0]}
                      </span>
                    </div>
                    <div
                      className="w-1 h-8 mx-4 rounded-full"
                      style={{ backgroundColor: event.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate flex items-center gap-2 ${
                        event.type === 'commitment'
                          ? 'text-blue-900 dark:text-blue-100'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {event.type === 'commitment' && (
                          <Settings size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
                        )}
                        <span className="truncate">{event.title}</span>
                        {event.type === 'commitment' && (
                          <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-1 rounded-full flex-shrink-0">
                            Fixed
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {event.time}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    );
  };

  // Calculate min/max for zoom effect - consistent full day view
  let minTime: Date, maxTime: Date;
  // All intervals show the same full day range - extended to show all commitments
    minTime = new Date(0, 0, 0, 4, 0, 0);  // 4 AM
    maxTime = new Date(0, 0, 0, 23, 59, 0);  // 11:59 PM (just before midnight)

  // If mobile, render the mobile calendar component
  if (isMobile) {
    return (
      <MobileCalendarView
        studyPlans={studyPlans}
        fixedCommitments={fixedCommitments}
        tasks={tasks}
        settings={settings}
        onSelectTask={onSelectTask}
        onStartManualSession={onStartManualSession}
        onDeleteFixedCommitment={onDeleteFixedCommitment}
        onUpdateStudyPlans={onUpdateStudyPlans}
      />
    );
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="bg-gradient-to-br from-blue-50 via-white to-purple-50 rounded-2xl shadow-xl p-6 dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 dark:shadow-gray-900 dark:text-gray-100">
        {/* Drag feedback notification */}
        {dragFeedback && (
          <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg border-l-4 transition-all duration-300 transform ${
            dragFeedback.includes('✅') ? 'bg-green-500 border-green-700 text-white' :
            dragFeedback.includes('📍') ? 'bg-blue-500 border-blue-700 text-white' :
            dragFeedback.includes('🔄') ? 'bg-orange-500 border-orange-700 text-white' :
            dragFeedback.includes('Dragging') ? 'bg-purple-500 border-purple-700 text-white' :
            dragFeedback.includes('micro-movement') ? 'bg-gray-500 border-gray-700 text-white' :
            'bg-red-500 border-red-700 text-white'
          }`}>
            <div className="flex items-center space-x-2">
              <span className="font-medium">{dragFeedback}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center space-x-2 dark:text-white">
            <BookOpen className="text-blue-600 dark:text-blue-400" size={28} />
            <span>Smart Calendar {isDragging && <span className="text-sm text-blue-500">(Dragging...)</span>}</span>
          </h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowInfoModal(true)}
              className="p-2 rounded-lg bg-blue-100 hover:bg-blue-200 dark:bg-blue-800 dark:hover:bg-blue-700 transition-colors"
              title="Learn about Drag & Drop"
            >
              <svg className="text-blue-600 dark:text-blue-300" fill="currentColor" viewBox="0 0 24 24" width="20" height="20">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
              </svg>
            </button>
            <button
              onClick={() => setShowColorSettings(true)}
              className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors"
              title="Customize Colors"
            >
              <Settings size={20} className="text-gray-600 dark:text-gray-300" />
            </button>
          </div>
        </div>
      {/* Legends */}
      <div className="mb-4 flex flex-wrap gap-4">
        {/* Task Category Legends - Only show default categories that exist in tasks */}
        {taskCategories.filter(category => defaultCategories.includes(category)).map(category => (
          <div key={category} className="flex items-center space-x-2">
            <span style={{ background: categoryColorMap[category], width: 16, height: 16, borderRadius: '50%', display: 'inline-block', border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}></span>
            <span className="text-sm text-gray-700 font-medium dark:text-gray-300 capitalize">{category}</span>
        </div>
        ))}
        {/* Default Category Legends (for categories not yet used) */}
        {['Academics', 'Personal', 'Learning', 'Home', 'Finance', 'Organization', 'Work', 'Health', 'Routine'].filter(category => !taskCategories.includes(category)).map(category => {
          let color = '#64748b'; // Default gray
          switch (category.toLowerCase()) {
            case 'academics':
              color = '#3b82f6'; // Blue
              break;
            case 'personal':
              color = '#a21caf'; // Purple
              break;
            case 'learning':
              color = '#a855f7'; // Lavender
              break;
            case 'home':
              color = '#f472b6'; // Light pink
              break;
            case 'finance':
              color = '#10b981'; // Green
              break;
            case 'organization':
              color = '#eab308'; // Yellow
              break;
            case 'work':
              color = '#f59e0b'; // Orange
              break;
            case 'health':
              color = '#ef4444'; // Red
              break;
            case 'routine':
              color = '#6366f1'; // Indigo
              break;
          }
          return (
            <div key={category} className="flex items-center space-x-2">
              <span style={{ background: color, width: 16, height: 16, borderRadius: '50%', display: 'inline-block', border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}></span>
              <span className="text-sm text-gray-700 font-medium dark:text-gray-300 capitalize">{category}</span>
            </div>
          );
        })}
        {/* Commitments now use the same category colors as tasks, so no separate legend needed */}
        {/* Show uncategorized legend only if there are custom/uncategorized tasks - positioned next to commitments */}
        {(taskCategories.some(category => !defaultCategories.includes(category)) || tasks.some(task => !task.category)) && (
          <div className="flex items-center space-x-2">
            <span style={{ background: colorSettings.uncategorizedTaskColor, width: 16, height: 16, borderRadius: '50%', display: 'inline-block', border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}></span>
            <span className="text-sm text-gray-700 font-medium dark:text-gray-300">Uncategorized</span>
          </div>
        )}
      </div>
      {/* Always render the toolbar */}
      <CustomToolbar
        label={currentView === 'agenda' ?
          (() => {
            const endDate = new Date(currentDate);
            endDate.setDate(endDate.getDate() + 6);
            return `${moment(currentDate).format('MMM D')} - ${moment(endDate).format('MMM D, YYYY')}`;
          })() :
          moment(currentDate).format('MMMM YYYY')
        }
        onNavigate={(action: string) => {
          const newDate = new Date(currentDate);
          if (currentView === 'agenda') {
            if (action === 'PREV') {
              newDate.setDate(newDate.getDate() - 7);
            } else if (action === 'NEXT') {
              newDate.setDate(newDate.getDate() + 7);
            }
          } else {
            // For other views, navigate by month/week/day
            if (action === 'PREV') {
              if (currentView === 'month') {
                newDate.setMonth(newDate.getMonth() - 1);
              } else if (currentView === 'week') {
                newDate.setDate(newDate.getDate() - 7);
              } else if (currentView === 'day') {
                newDate.setDate(newDate.getDate() - 1);
              }
            } else if (action === 'NEXT') {
              if (currentView === 'month') {
                newDate.setMonth(newDate.getMonth() + 1);
              } else if (currentView === 'week') {
                newDate.setDate(newDate.getDate() + 7);
              } else if (currentView === 'day') {
                newDate.setDate(newDate.getDate() + 1);
              }
            }
          }
          setCurrentDate(newDate);
        }}
        onView={(view: string) => setCurrentView(view)}
        view={currentView}
      />

      <div
        style={{
          height: '600px',
          borderRadius: '1.5rem',
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.95)',
          boxShadow: '0 4px 24px rgba(80,80,180,0.07)',
        }}
        className="calendar-grid-container dark:bg-gray-900 dark:bg-opacity-95"
      >
        {currentView === 'agenda' ? (
          <CustomAgenda />
        ) : (
          <DragAndDropCalendar
            localizer={localizer}
            events={events}
            startAccessor={(event: any) => (event as CalendarEvent).start}
            endAccessor={(event: any) => (event as CalendarEvent).end}
            style={{ height: '100%' }}
            views={[Views.MONTH, Views.WEEK, Views.DAY]}
            defaultView={Views.WEEK}
            view={currentView as any}
            onView={(view: string) => setCurrentView(view)}
            date={currentDate}
            onNavigate={(date: Date) => setCurrentDate(date)}
            step={timeInterval}
            timeslots={
              timeInterval === 5 ? 12 :
              timeInterval === 10 ? 6 :
              timeInterval === 15 ? 4 :
              timeInterval === 30 ? 2 :
              1
            }
            min={minTime}
            max={maxTime}
            onSelectEvent={(event: any) => handleSelectEvent(event as CalendarEvent)}
            eventPropGetter={(event: any, start: Date, end: Date, isSelected: boolean) => eventStyleGetter(event as CalendarEvent, start, end, isSelected)}
            formats={{
              timeGutterFormat: customGutterHeader,
              eventTimeRangeFormat: ({ start, end }) =>
                `${moment(start).format('HH:mm')} - ${moment(end).format('HH:mm')}`
            }}
            components={{
              toolbar: () => null, // Disable built-in toolbar since we render it separately
              event: CustomEventComponent
            }}
            rtl={false}
            dayLayoutAlgorithm="no-overlap"
            draggableAccessor={(event: any) => {
              const calendarEvent = event as CalendarEvent;

              // Allow dragging of commitments that count toward daily hours
              if (calendarEvent.resource.type === 'commitment') {
                const commitment = calendarEvent.resource.data as FixedCommitment;
                return commitment.countsTowardDailyHours || false;
              }

              // Allow dragging of study sessions
              if (calendarEvent.resource.type === 'study') {
                const session = calendarEvent.resource.data;
                const planDate = calendarEvent.resource.planDate || moment(calendarEvent.start).format('YYYY-MM-DD');
                const sessionStatus = checkSessionStatus(session as StudySession, planDate);

                // Don't allow dragging of completed or done sessions
                return sessionStatus !== 'completed' &&
                       !(session as StudySession).done;
              }

              return false;
            }}
            resizable={false}
            onEventDrop={(args: any) => {
              const { event, start, end } = args;
              handleEventDrop({ event: event as CalendarEvent, start, end });
            }}
            onDragStart={handleDragStart}
          />
        )}
      </div>
      {/* Add custom CSS for thicker interval lines and better spacing */}
      <style>{`
        .rbc-time-slot {
          border-bottom: 2px solid #e0e7ef !important;
        }
        .dark .calendar-grid-container {
          background: rgba(24,24,27,0.95) !important;
        }
        .dark .rbc-time-slot {
          border-bottom: 2px solid #27272a !important;
        }
        .dark .rbc-month-row, .dark .rbc-month-view, .dark .rbc-header, .dark .rbc-time-header, .dark .rbc-timeslot-group, .dark .rbc-time-content {
          background-color: #18181b !important;
        }
        .dark .rbc-date-cell, .dark .rbc-day-bg {
          background-color: #18181b !important;
        }
        .dark .rbc-off-range-bg {
          background-color: #23232a !important;
        }
        .dark .rbc-current {
          background-color: #334155 !important;
        }
        .dark .rbc-label, .dark .rbc-header, .dark .rbc-date-cell, .dark .rbc-timeslot-group, .dark .rbc-time-gutter, .dark .rbc-time-header-content {
          color: #e5e7eb !important;
        }
        
        /* Dynamic spacing based on interval size */
        .rbc-time-view .rbc-timeslot-group {
          min-height: 24px !important;
        }
        
        /* Zoom-based time slot heights */
        .rbc-time-slot {
          min-height: 24px !important;
        }
        
        /* More distinct hour grid lines */
        .rbc-time-slot:first-child {
          border-top: 3px solid #d1d5db !important;
        }
        
        .rbc-time-slot:not(:first-child) {
          border-top: 1px solid #e5e7eb !important;
        }
        
        /* Dark mode hour grid lines */
        .dark .rbc-time-slot:first-child {
          border-top: 3px solid #4b5563 !important;
        }
        
        .dark .rbc-time-slot:not(:first-child) {
          border-top: 1px solid #374151 !important;
        }
        
        /* Ensure events have minimum height for readability */
        .rbc-event {
          min-height: 22px !important;
          min-width: 60px !important;
        }
        
        /* Better text sizing for event blocks */
        .rbc-event .text-sm {
          font-size: 12px !important;
          line-height: 1.3 !important;
        }
        
        /* Enhanced time gutter for zoomed views */
        .rbc-time-gutter {
          min-width: 60px !important;
          font-weight: 500 !important;
        }
        
        /* Better visual separation for zoomed intervals */
        .rbc-time-header-content {
          border-bottom: 2px solid #e0e7ef !important;
        }
        
        .dark .rbc-time-header-content {
          border-bottom: 2px solid #27272a !important;
        }
        
        /* Darker styling for past days */
        .rbc-day-bg.rbc-off-range {
          background-color: #f8f9fa !important;
        }
        
        .rbc-day-bg.rbc-off-range.rbc-past {
          background-color: #e9ecef !important;
        }
        
        .rbc-day-bg.rbc-past {
          background-color: #f1f3f4 !important;
        }
        
        /* Dark mode past days */
        .dark .rbc-day-bg.rbc-off-range {
          background-color: #1f2937 !important;
        }
        
        .dark .rbc-day-bg.rbc-off-range.rbc-past {
          background-color: #111827 !important;
        }
        
        .dark .rbc-day-bg.rbc-past {
          background-color: #1e293b !important;
        }
        
        /* Past time slots in time view */
        .rbc-timeslot-group.rbc-past {
          background-color: #f8f9fa !important;
        }
        
        .dark .rbc-timeslot-group.rbc-past {
          background-color: #1f2937 !important;
        }

        /* Drag and Drop Styles - Enhanced for precision */
        .rbc-addons-dnd-drag-preview {
          background-color: rgba(59, 130, 246, 0.2) !important;
          border: 3px dashed #3b82f6 !important;
          opacity: 0.8 !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3) !important;
        }

        .rbc-addons-dnd-over {
          background-color: rgba(34, 197, 94, 0.15) !important;
          border: 3px solid #22c55e !important;
          border-radius: 8px !important;
          box-shadow: 0 2px 8px rgba(34, 197, 94, 0.2) !important;
        }

        .rbc-event.rbc-addons-dnd-dragged-event {
          opacity: 0.4 !important;
          cursor: grabbing !important;
          transform: scale(0.98) !important;
          transition: transform 0.1s ease !important;
        }

        .rbc-event:hover {
          cursor: grab !important;
          transform: scale(1.02) !important;
          transition: transform 0.1s ease !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15) !important;
        }

        /* Make commitment events draggable when they should be */
        .rbc-event:hover {
          cursor: grab !important;
          transform: scale(1.02) !important;
          transition: transform 0.1s ease !important;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15) !important;
        }

        /* Override for non-draggable completed/done sessions */
        .rbc-event.non-draggable:hover {
          cursor: not-allowed !important;
          transform: none !important;
          box-shadow: none !important;
        }

        .rbc-event.non-draggable:hover {
          cursor: not-allowed !important;
          transform: none !important;
          box-shadow: none !important;
        }

        /* Enhanced grid lines during drag */
        .rbc-addons-dnd .rbc-time-slot {
          transition: background-color 0.1s ease !important;
        }

        .rbc-addons-dnd .rbc-time-slot:hover {
          background-color: rgba(59, 130, 246, 0.05) !important;
        }

        /* Resize handles disabled */
        .rbc-addons-dnd-resize-south-anchor,
        .rbc-addons-dnd-resize-north-anchor {
          display: none !important;
        }

        /* Commitments that count toward daily hours are now draggable */

        /* Better visual feedback for valid drop zones */
        .rbc-time-slot.rbc-dnd-over {
          background-color: rgba(34, 197, 94, 0.1) !important;
          border-left: 4px solid #22c55e !important;
        }
      `}</style>

      {/* Color Settings Modal */}
      {showColorSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6 calendar-toolbar">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                  Customize Calendar Colors
                </h2>
                <button
                  onClick={() => setShowColorSettings(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                {/* Task Category Colors */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Task Category Colors</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* All default categories */}
                    {['Academics', 'Personal', 'Learning', 'Home', 'Finance', 'Organization', 'Work', 'Health', 'Routine'].map(category => {
                      let defaultColor = '#64748b';
                      switch (category.toLowerCase()) {
                        case 'academics':
                          defaultColor = '#3b82f6'; // Blue
                          break;
                        case 'personal':
                          defaultColor = '#a21caf'; // Purple
                          break;
                        case 'learning':
                          defaultColor = '#a855f7'; // Lavender
                          break;
                        case 'home':
                          defaultColor = '#f472b6'; // Light pink
                          break;
                        case 'finance':
                          defaultColor = '#10b981'; // Green
                          break;
                        case 'organization':
                          defaultColor = '#eab308'; // Yellow
                          break;
                        case 'work':
                          defaultColor = '#f59e0b'; // Orange
                          break;
                        case 'health':
                          defaultColor = '#ef4444'; // Red
                          break;
                        case 'routine':
                          defaultColor = '#6366f1'; // Indigo
                          break;
                      }
                      return (
                        <div key={category} className="flex items-center space-x-3">
                          <input
                            type="color"
                            value={categoryColorMap[category] || defaultColor}
                            onChange={(e) => {
                              // Update the category colors state which will persist and trigger re-render
                              setCategoryColors(prev => ({
                                ...prev,
                                [category]: e.target.value
                              }));
                            }}
                            className="w-12 h-8 rounded border border-gray-300 dark:border-gray-600"
                          />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">
                            {category}
                          </span>
                        </div>
                      );
                    })}
                    {/* Uncategorized tasks */}
                    <div className="flex items-center space-x-3">
                      <input
                        type="color"
                        value={colorSettings.uncategorizedTaskColor}
                        onChange={(e) => handleSpecialColorChange('uncategorizedTaskColor', e.target.value)}
                        className="w-12 h-8 rounded border border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Uncategorized
                      </span>
                    </div>
                  </div>
                </div>

                {/* Commitments now use category-based colors instead of a single color */}

                {/* Special Status Colors */}
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">Special Status Colors</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                    <div className="flex items-center space-x-3">
                      <input
                        type="color"
                        value={colorSettings.missedColor}
                        onChange={(e) => handleSpecialColorChange('missedColor', e.target.value)}
                        className="w-12 h-8 rounded border border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Missed
                      </span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <input
                        type="color"
                        value={colorSettings.completedColor}
                        onChange={(e) => handleSpecialColorChange('completedColor', e.target.value)}
                        className="w-12 h-8 rounded border border-gray-300 dark:border-gray-600"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Completed
                      </span>
                    </div>
                  </div>
                </div>



                {/* Action Buttons */}
                <div className="flex justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={resetToDefaults}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
                  >
                    Reset to Defaults
                  </button>
                  <button
                    onClick={() => setShowColorSettings(false)}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info Modal for Drag & Drop */}
      {showInfoModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                  <BookOpen className="text-blue-500" size={28} />
                  <span>Smart Calendar Guide</span>
                </h2>
                <button
                  onClick={() => setShowInfoModal(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                {/* Drag and Drop Section */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-5 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center space-x-2 mb-4">
                    <svg className="text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 24 24" width="24" height="24">
                      <path d="M13 6v5h5l-6 6-6-6h5V6h2z"/>
                    </svg>
                    <h3 className="text-lg font-bold text-blue-800 dark:text-blue-200">Drag & Drop Sessions</h3>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start space-x-3">
                      <span className="text-green-600 dark:text-green-400 font-bold mt-0.5">✓</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Move study sessions:</strong> Click and drag any study session to reschedule it to a different time
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="text-green-600 dark:text-green-400 font-bold mt-0.5">✓</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Smart placement:</strong> Sessions will place exactly where you drop them, or find the nearest available slot if there's a conflict
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="text-green-600 dark:text-green-400 font-bold mt-0.5">✓</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Automatic buffer time:</strong> Respects your buffer time settings between sessions to prevent scheduling conflicts
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="text-orange-600 dark:text-orange-400 font-bold mt-0.5">⚠</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Restrictions:</strong> Completed sessions and commitments cannot be moved
                      </p>
                    </div>
                  </div>
                </div>

                {/* Time Intervals Section */}
                <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 rounded-lg p-5 border border-purple-200 dark:border-purple-800">
                  <div className="flex items-center space-x-2 mb-4">
                    <Clock className="text-purple-600 dark:text-purple-400" size={24} />
                    <h3 className="text-lg font-bold text-purple-800 dark:text-purple-200">Time Interval Settings</h3>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start space-x-3">
                      <span className="text-blue-600 dark:text-blue-400 font-bold mt-0.5">📍</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Precision control:</strong> Use smaller intervals (5-15 min) for more precise session placement
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="text-blue-600 dark:text-blue-400 font-bold mt-0.5">⚡</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Quick positioning:</strong> Larger intervals (30-60 min) provide faster, grid-aligned placement
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="text-green-600 dark:text-green-400 font-bold mt-0.5">💡</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Pro tip:</strong> Change intervals using the dropdown in the calendar toolbar for optimal positioning accuracy
                      </p>
                    </div>
                  </div>
                </div>

                {/* Study Plan Integration */}
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 rounded-lg p-5 border border-emerald-200 dark:border-emerald-800">
                  <div className="flex items-center space-x-2 mb-4">
                    <CalendarIcon className="text-emerald-600 dark:text-emerald-400" size={24} />
                    <h3 className="text-lg font-bold text-emerald-800 dark:text-emerald-200">Study Plan Integration</h3>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start space-x-3">
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">🔄</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Real-time sync:</strong> Rearranged sessions automatically update in your Study Plan view
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">📊</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Status tracking:</strong> Moved sessions show as "Rescheduled" with original time reference
                      </p>
                    </div>
                    <div className="flex items-start space-x-3">
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">✨</span>
                      <p className="text-gray-700 dark:text-gray-300">
                        <strong>Manual override:</strong> Your manual changes take priority over automatic scheduling
                      </p>
                    </div>
                  </div>
                </div>

                {/* Visual Feedback */}
                <div className="bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 rounded-lg p-5 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center space-x-2 mb-4">
                    <svg className="text-amber-600 dark:text-amber-400" fill="currentColor" viewBox="0 0 24 24" width="24" height="24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                    <h3 className="text-lg font-bold text-amber-800 dark:text-amber-200">Visual Feedback</h3>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 bg-green-500 rounded"></div>
                        <span className="text-gray-700 dark:text-gray-300">Exact placement</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 bg-blue-500 rounded"></div>
                        <span className="text-gray-700 dark:text-gray-300">Near target</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 bg-orange-500 rounded"></div>
                        <span className="text-gray-700 dark:text-gray-300">Nearest available</span>
                      </div>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-xs">
                      Color-coded notifications show exactly where your session was placed and why
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-6 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setShowInfoModal(false)}
                  className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Got it!
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add modal for manual session */}
      {selectedManualSession && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                  <Clock className="text-blue-500" size={24} />
                  <span>Manual Rescheduled Session</span>
                </h2>
                <button
                  onClick={() => setSelectedManualSession(null)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="mb-4">
                <div className="font-semibold text-gray-700 dark:text-gray-200 mb-1">{selectedManualSession.title}</div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                  {selectedManualSession.startTime} - {selectedManualSession.endTime}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mb-2">
                  Duration: {(() => {
                    const [sh, sm] = (selectedManualSession.startTime || '00:00').split(":").map(Number);
                    const [eh, em] = (selectedManualSession.endTime || '23:59').split(":").map(Number);
                    let mins = (eh * 60 + em) - (sh * 60 + sm);
                    if (mins < 0) mins += 24 * 60;
                    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                  })()}
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => {
                    // Start session (redirect to timer)
                    if (onStartManualSession) {
                      const [sh, sm] = (selectedManualSession.startTime || '00:00').split(":").map(Number);
                      const [eh, em] = (selectedManualSession.endTime || '23:59').split(":").map(Number);
                      let mins = (eh * 60 + em) - (sh * 60 + sm);
                      if (mins < 0) mins += 24 * 60;
                      setSelectedManualSession(null);
                      onStartManualSession(selectedManualSession, mins * 60);
                    } else {
                      setSelectedManualSession(null);
                    }
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Start Session
                </button>
                <button
                  onClick={() => {
                    if (onDeleteFixedCommitment) {
                      onDeleteFixedCommitment(selectedManualSession.id);
                    }
                    setSelectedManualSession(null);
                  }}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                >
                  Delete Session
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      </div>
    </DndProvider>
  );
};

export default CalendarView;
