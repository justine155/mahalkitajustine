import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Clock, BookOpen, X, Play, Trash2 } from 'lucide-react';
import { StudyPlan, FixedCommitment, Task, StudySession, UserSettings } from '../types';
import { checkSessionStatus, formatTime, validateTimeSlot, doesCommitmentApplyToDate, getDaySpecificDailyHours } from '../utils/scheduling';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';
import moment from 'moment';

interface MobileCalendarViewProps {
  studyPlans: StudyPlan[];
  fixedCommitments: FixedCommitment[];
  tasks: Task[];
  settings?: UserSettings;
  onSelectTask?: (task: Task, session?: { allocatedHours: number; planDate?: string; sessionNumber?: number }) => void;
  onStartManualSession?: (commitment: FixedCommitment, durationSeconds: number) => void;
  onDeleteFixedCommitment?: (commitmentId: string) => void;
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
    data: any;
  };
}

const MobileCalendarView: React.FC<MobileCalendarViewProps> = ({
  studyPlans,
  fixedCommitments,
  tasks,
  settings,
  onSelectTask,
  onStartManualSession,
  onDeleteFixedCommitment,
  onUpdateStudyPlans,
}) => {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragFeedback, setDragFeedback] = useState<string>('');

  // Utility function to find available time slots (copied from CalendarView)
  const findNearestAvailableSlot = (targetStart: Date, sessionDuration: number, targetDate: string): { start: Date; end: Date } | null => {
    if (!settings) return null;

    // Get all busy slots for the target date
    const busySlots: Array<{ start: Date; end: Date }> = [];

    // Add existing study sessions
    studyPlans.forEach(plan => {
      if (plan.date === targetDate) {
        plan.plannedTasks.forEach(session => {
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
    const bufferTimeMs = (settings.bufferTimeBetweenSessions || 0) * 60 * 1000;

    // Function to check if a slot is valid
    const isSlotValid = (slotStart: Date, slotEnd: Date) => {
      if (slotStart < dayStart || slotEnd > dayEnd) return false;
      for (const busySlot of busySlots) {
        const adjustedStart = new Date(slotStart.getTime() - bufferTimeMs);
        const adjustedEnd = new Date(slotEnd.getTime() + bufferTimeMs);
        if (adjustedStart < busySlot.end && adjustedEnd > busySlot.start) {
          return false;
        }
      }
      return true;
    };

    // Try to find the nearest available slot
    const bufferMinutes = Math.max(settings.bufferTimeBetweenSessions || 15, 5);
    const gridSize = bufferMinutes * 60 * 1000;
    const roundedTarget = new Date(Math.round(targetStart.getTime() / gridSize) * gridSize);

    for (let offset = 0; offset <= 12 * 60 * 60 * 1000; offset += gridSize) {
      for (const direction of [1, -1]) {
        const testStart = new Date(roundedTarget.getTime() + (direction * offset));
        const testEnd = new Date(testStart.getTime() + sessionDurationMs);
        if (isSlotValid(testStart, testEnd)) {
          return { start: testStart, end: testEnd };
        }
      }
    }
    return null;
  };

  // Generate dates for the horizontal picker (7 days around selected date)
  const dateRange = useMemo(() => {
    const dates = [];
    const startDate = moment(selectedDate).subtract(3, 'days');
    for (let i = 0; i < 7; i++) {
      dates.push(moment(startDate).add(i, 'days').toDate());
    }
    return dates;
  }, [selectedDate]);

  // Get events for the selected date
  const selectedDateEvents = useMemo(() => {
    const events: CalendarEvent[] = [];
    const selectedDateStr = moment(selectedDate).format('YYYY-MM-DD');

    // --- Study Sessions ---
    const selectedPlan = studyPlans.find(plan => plan.date === selectedDateStr);
    if (selectedPlan) {
      // Filter out past incomplete sessions (forward focus approach)
      const today = moment().format('YYYY-MM-DD');
      const relevantSessions = selectedPlan.plannedTasks.filter(() => {
        // Show only today and future; hide all past sessions (completed/skipped included)
        return selectedDateStr >= today;
      });

      relevantSessions.forEach(session => {
        const task = tasks.find(t => t.id === session.taskId);
        if (task) {
          // Ensure correct parsing of startTime and endTime for the selectedDate
          const startTime = moment(selectedDate)
            .set({
              hour: parseInt(session.startTime.split(':')[0], 10),
              minute: parseInt(session.startTime.split(':')[1], 10),
              second: 0,
              millisecond: 0
            });
          const endTime = moment(selectedDate)
            .set({
              hour: parseInt(session.endTime.split(':')[0], 10),
              minute: parseInt(session.endTime.split(':')[1], 10),
              second: 0,
              millisecond: 0
            });

          events.push({
            id: `${session.taskId}-${session.sessionNumber}`, // Unique ID for each session
            title: `${task.title} (Session ${session.sessionNumber})`,
            start: startTime.toDate(),
            end: endTime.toDate(),
            resource: {
              type: 'study',
              data: { session, task }
            }
          });
        }
      });
    }

    // --- Fixed Commitments ---
    const dayOfWeek = selectedDate.getDay();
    fixedCommitments.forEach(commitment => {
      let shouldInclude = false;
      
      if (commitment.recurring) {
        // For recurring commitments, check if the day of week matches
        shouldInclude = commitment.daysOfWeek.includes(dayOfWeek);
        
        // If there's a date range, check if the current date is within that range
        if (shouldInclude && commitment.dateRange?.startDate && commitment.dateRange?.endDate) {
          // Add one day to endDate to include the full last day
          const endDateObj = new Date(commitment.dateRange.endDate);
          endDateObj.setDate(endDateObj.getDate() + 1);
          const inclusiveEndDate = endDateObj.toISOString().split('T')[0];
          shouldInclude = selectedDateStr >= commitment.dateRange.startDate && selectedDateStr < inclusiveEndDate;
        }
      } else {
        // For non-recurring commitments, check if the specific date matches
        shouldInclude = commitment.specificDates?.includes(selectedDateStr) || false;
      }
      
      if (shouldInclude) {
        const dateString = selectedDateStr;
        
        // Skip deleted occurrences to prevent them from being displayed
        if (commitment.deletedOccurrences?.includes(dateString)) {
          return; 
        }

        // Check for modified occurrence for the specific date
        const modifiedSession = commitment.modifiedOccurrences?.[dateString];
        
        // Check if this is an all-day event (either from the commitment or a modified occurrence)
        const isAllDay = modifiedSession?.isAllDay !== undefined ? modifiedSession.isAllDay : commitment.isAllDay;
        
        let startTime, endTime;
        
        if (isAllDay) {
          // For all-day events, set time to 00:00:00 for start and 23:59:59 for end
          startTime = moment(selectedDate).startOf('day');
          endTime = moment(selectedDate).endOf('day');
        } else {
          // Use modified times if they exist, otherwise use original commitment times
          const [startHour, startMinute] = (modifiedSession?.startTime || commitment.startTime || '00:00').split(':').map(Number);
          const [endHour, endMinute] = (modifiedSession?.endTime || commitment.endTime || '23:59').split(':').map(Number);
          
          // Set the hour and minute on the selectedDate to create the correct timestamp
          startTime = moment(selectedDate)
            .set({
              hour: startHour,
              minute: startMinute,
              second: 0,
              millisecond: 0
            });
          endTime = moment(selectedDate)
            .set({
              hour: endHour,
              minute: endMinute,
              second: 0,
              millisecond: 0
            });
        }
        
        events.push({
          id: commitment.id, // Using commitment ID as the event ID
          title: modifiedSession?.title || commitment.title,
          start: startTime.toDate(),
          end: endTime.toDate(),
          allDay: isAllDay,
          resource: {
            type: 'commitment',
            data: {
              ...commitment, // Spread original commitment data
              title: modifiedSession?.title || commitment.title, // Override with modified title if present
              startTime: modifiedSession?.startTime || commitment.startTime, // Override with modified start time if present
              endTime: modifiedSession?.endTime || commitment.endTime, // Override with modified end time if present
              category: modifiedSession?.category || commitment.category, // Override with modified category if present
              isAllDay: isAllDay // Include the all-day flag
            }
          }
        });
      }
    });

    // Sort events by start time to ensure correct chronological display
    return events.sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [selectedDate, studyPlans, fixedCommitments, tasks]);

  // Generate time slots (4 AM to 11 PM) for the vertical timeline
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let hour = 4; hour <= 23; hour++) {
      slots.push(hour);
    }
    return slots;
  }, []);

  // Determine event color based on type and status
  const getEventColor = (event: CalendarEvent) => {
    if (event.resource.type === 'commitment') {
      const commitment = event.resource.data as FixedCommitment;
      // Use category-based colors for commitments, same as tasks
      switch (commitment.category?.toLowerCase()) {
        case 'academics': return '#3b82f6'; // Blue
        case 'work': return '#f59e0b';    // Orange
        case 'personal': return '#a21caf'; // Purple
        case 'health': return '#ef4444'; // Red
        case 'learning': return '#a855f7'; // Lavender
        case 'finance': return '#10b981'; // Green
        case 'home': return '#f472b6'; // Pink
        case 'organization': return '#eab308'; // Yellow
        case 'buffer': return '#6366f1'; // Indigo
        default: return '#64748b';       // Default gray
      }
    } else {
      const { session, task } = event.resource.data;
      const sessionStatus = checkSessionStatus(session, moment(selectedDate).format('YYYY-MM-DD'));
      
      if (sessionStatus === 'missed') return '#dc2626';  // Red
      if (session.done || session.status === 'completed') return '#d1d5db'; // Light Gray (completed)
      if (task.importance) return '#f59e0b';           // Amber (important tasks)
      
      // Fallback to category color if available
      return task.category ? getCategoryColor(task.category) : '#64748b'; // Default gray
    }
  };

  // Helper to get color based on task category
  const getCategoryColor = (category: string): string => {
    switch (category.toLowerCase()) {
      case 'academics': return '#3b82f6';
      case 'personal': return '#a21caf';
      case 'learning': return '#a855f7';
      case 'home': return '#f472b6';
      case 'finance': return '#10b981';
      case 'organization': return '#eab308';
      case 'work': return '#f59e0b';
      case 'health': return '#ef4444';
      default: return '#64748b';
    }
  };

  // Handle click on a calendar event
  const handleEventClick = (event: CalendarEvent) => {
    const todayStr = moment().format('YYYY-MM-DD');
    const eventDateStr = moment(event.start).format('YYYY-MM-DD');

    if (event.resource.type === 'study') {
      setSelectedEvent(event);
      return;
    }

    if (event.resource.type === 'commitment' && onStartManualSession && eventDateStr === todayStr) {
      const commitment = event.resource.data as FixedCommitment;
      const durationSeconds = Math.max(0, moment(event.end).diff(moment(event.start), 'seconds'));
      onStartManualSession(commitment, durationSeconds);
    }
  };

  // Handle starting a manual commitment session from the detail modal
  const handleStartSession = () => {
    if (selectedEvent && selectedEvent.resource.type === 'commitment' && onStartManualSession) {
      const commitment = selectedEvent.resource.data as FixedCommitment;
      // Calculate duration in seconds
      const startMoment = moment(commitment.startTime, 'HH:mm');
      const endMoment = moment(commitment.endTime, 'HH:mm');
      let durationMinutes = endMoment.diff(startMoment, 'minutes');
      if (durationMinutes < 0) { // Handle overnight commitments
        durationMinutes += 24 * 60;
      }
      onStartManualSession(commitment, durationMinutes * 60);
    }
    setSelectedEvent(null); // Close modal after starting
  };

  // Handle deleting a fixed commitment from the detail modal (deletes the entire commitment)
  const handleDeleteSession = () => {
    if (selectedEvent && selectedEvent.resource.type === 'commitment' && onDeleteFixedCommitment) {
      onDeleteFixedCommitment(selectedEvent.resource.data.id);
    }
    setSelectedEvent(null); // Close modal after deleting
  };

  // Handle mobile drag and drop
  const handleMobileDrop = (draggedEvent: CalendarEvent, targetHour: number) => {
    if (!onUpdateStudyPlans || !settings || draggedEvent.resource.type !== 'study') {
      setDragFeedback('Only study sessions can be moved');
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    const session = draggedEvent.resource.data.session as StudySession;
    const targetDate = moment(selectedDate).format('YYYY-MM-DD');
    const originalDate = session.planDate || moment(draggedEvent.start).format('YYYY-MM-DD');
    const sessionDuration = session.allocatedHours;

    // Restrict movement to same day only
    if (targetDate !== originalDate) {
      setDragFeedback('Sessions can only be moved within the same day');
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    // Create target start time
    const targetStart = moment(selectedDate).hour(targetHour).minute(0).second(0).toDate();

    // Check if target day is a work day
    const targetDayOfWeek = moment(selectedDate).day();
    if (!settings.workDays.includes(targetDayOfWeek)) {
      setDragFeedback(`Cannot move session to ${moment(selectedDate).format('dddd')} - not a work day`);
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    // Find the nearest available slot
    const availableSlot = findNearestAvailableSlot(targetStart, sessionDuration, targetDate);

    if (!availableSlot) {
      setDragFeedback('No available time slot found for this session');
      setTimeout(() => setDragFeedback(''), 3000);
      return;
    }

    // Update the study plans (same logic as desktop version)
    const updatedPlans = studyPlans.map(plan => {
      if (plan.date === targetDate) {
        const newSession = {
          ...session,
          startTime: moment(availableSlot.start).format('HH:mm'),
          endTime: moment(availableSlot.end).format('HH:mm'),
          originalTime: session.originalTime || session.startTime,
          originalDate: session.originalDate || originalDate,
          rescheduledAt: new Date().toISOString(),
          isManualOverride: true
        };

        const existingSessionIndex = plan.plannedTasks.findIndex(s =>
          s.taskId === session.taskId && s.sessionNumber === session.sessionNumber
        );

        if (existingSessionIndex >= 0) {
          const updatedTasks = [...plan.plannedTasks];
          updatedTasks[existingSessionIndex] = newSession;
          return { ...plan, plannedTasks: updatedTasks };
        } else {
          return {
            ...plan,
            plannedTasks: [...plan.plannedTasks, newSession]
          };
        }
      } else if (plan.date === originalDate) {
        const updatedTasks = plan.plannedTasks.filter(s =>
          !(s.taskId === session.taskId && s.sessionNumber === session.sessionNumber)
        );
        return { ...plan, plannedTasks: updatedTasks };
      } else {
        return plan;
      }
    });

    // Handle case when target date doesn't exist in plans
    const targetPlanExists = updatedPlans.some(plan => plan.date === targetDate);
    if (!targetPlanExists) {
      const newSession = {
        ...session,
        startTime: moment(availableSlot.start).format('HH:mm'),
        endTime: moment(availableSlot.end).format('HH:mm'),
        originalTime: session.originalTime || session.startTime,
        originalDate: session.originalDate || originalDate,
        rescheduledAt: new Date().toISOString(),
        isManualOverride: true
      };

      updatedPlans.push({
        id: `plan-${targetDate}`,
        date: targetDate,
        plannedTasks: [newSession],
        totalStudyHours: sessionDuration,
        isOverloaded: false,
        availableHours: getDaySpecificDailyHours(targetDate, settings)
      });

      const originalPlanIndex = updatedPlans.findIndex(plan => plan.date === originalDate);
      if (originalPlanIndex >= 0) {
        const originalPlan = updatedPlans[originalPlanIndex];
        const updatedOriginalTasks = originalPlan.plannedTasks.filter(s =>
          !(s.taskId === session.taskId && s.sessionNumber === session.sessionNumber)
        );
        updatedPlans[originalPlanIndex] = { ...originalPlan, plannedTasks: updatedOriginalTasks };
      }
    }

    onUpdateStudyPlans(updatedPlans);

    const snappedTime = moment(availableSlot.start).format('HH:mm');
    setDragFeedback(`Session moved to ${moment(targetDate).format('MMM D')} at ${snappedTime}`);
    setTimeout(() => setDragFeedback(''), 3000);
  };


  // Format hour for time slot display (e.g., "4 AM", "1 PM")
  const formatTimeSlot = (hour: number) => {
    return moment().hour(hour).format('h A');
  };

  // Filter events for a specific time slot to display on the timeline
  const getEventsForTimeSlot = (hour: number) => {
    return selectedDateEvents.filter(event => {
      const eventStartHour = event.start.getHours();
      const eventEndHour = event.end.getHours();
      // An event is relevant for a slot if it starts at or before the hour and ends after the hour.
      // This ensures events spanning multiple hours are shown in each relevant hour slot.
      return eventStartHour <= hour && eventEndHour > hour;
    });
  };

  // Draggable Event Component for mobile
  const DraggableEvent: React.FC<{ event: CalendarEvent; onEventClick: (event: CalendarEvent) => void }> = ({ event, onEventClick }) => {
    // Check if session is missed to prevent dragging
    const isStudySession = event.resource.type === 'study';
    const sessionStatus = isStudySession ? checkSessionStatus(event.resource.data.session, moment(selectedDate).format('YYYY-MM-DD')) : null;
    const [{ isDragging }, drag] = useDrag(() => ({
      type: 'event',
      item: event,
      canDrag: isStudySession, // All study sessions can be dragged
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }), [event, isStudySession]);

    // Handle drag start/end with useEffect
    React.useEffect(() => {
      if (isDragging) {
        setIsDragging(true);
        setDragFeedback('');
      } else {
        setIsDragging(false);
      }
    }, [isDragging]);

    const canDrag = isStudySession;

    return (
      <div
        ref={canDrag ? drag : null}
        onClick={() => onEventClick(event)}
        className={`mb-2 p-3 rounded-lg text-white text-sm font-medium transition-all duration-200 ${
          isDragging ? 'opacity-50 scale-95' : ''
        } ${canDrag ? 'cursor-move hover:opacity-80' : 'cursor-pointer hover:opacity-80'}`}
        style={{
          backgroundColor: getEventColor(event),
          touchAction: canDrag ? 'none' : 'auto' // Disable touch scrolling when dragging
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">
              {event.title} {(() => {
                if (event.allDay) return '';
                const durationHours = moment(event.end).diff(moment(event.start), 'hours', true);
                const durationMinutes = moment(event.end).diff(moment(event.start), 'minutes', true);
                if (durationHours >= 1) {
                  return `(${Math.round(durationHours)}h)`;
                } else if (durationMinutes > 0) {
                  return `(${Math.round(durationMinutes)}m)`;
                }
                return '';
              })()}
              {canDrag && <span className="text-xs ml-1">📱</span>}
            </div>
            <div className="text-xs opacity-90">
              {moment(event.start).format('h:mm A')} - {moment(event.end).format('h:mm A')}
            </div>
            {event.resource.type === 'study' && (
              <div className="text-xs opacity-75 mt-1">
                {formatTime(event.resource.data.session.allocatedHours)}
              </div>
            )}
          </div>
          <div className="ml-2">
            {event.resource.type === 'study' ? (
              <BookOpen size={16} />
            ) : (
              <Clock size={16} />
            )}
          </div>
        </div>
      </div>
    );
  };

  // Drop Zone Component for time slots
  const TimeSlotDropZone: React.FC<{ hour: number; children: React.ReactNode }> = ({ hour, children }) => {
    const [{ isOver, canDrop }, drop] = useDrop(() => ({
      accept: 'event',
      drop: (item: CalendarEvent) => {
        handleMobileDrop(item, hour);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }), [hour]);

    return (
      <div
        ref={drop}
        className={`flex-1 p-3 min-h-[60px] transition-colors duration-200 ${
          isOver && canDrop ? 'bg-green-100 dark:bg-green-900' : ''
        } ${canDrop && !isOver ? 'bg-blue-50 dark:bg-blue-900' : ''}`}
      >
        {children}
        {isOver && canDrop && (
          <div className="absolute inset-0 border-2 border-dashed border-green-500 rounded-lg pointer-events-none" />
        )}
      </div>
    );
  };

  return (
    <DndProvider backend={TouchBackend} options={{ enableMouseEvents: true }}>
      <div className="bg-gradient-to-br from-blue-50 via-white to-purple-50 rounded-2xl shadow-xl p-4 dark:from-gray-900 dark:via-gray-950 dark:to-gray-900">
        {/* Drag feedback notification */}
        {dragFeedback && (
          <div className="fixed top-4 right-4 z-50 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg">
            {dragFeedback}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
            <BookOpen className="text-blue-600 dark:text-blue-400" size={24} />
            <span>Calendar {isDragging && <span className="text-sm text-blue-500">(Dragging...)</span>}</span>
          </h2>
        </div>

      {/* Horizontal Date Picker */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setSelectedDate(moment(selectedDate).subtract(7, 'days').toDate())}
            className="p-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {moment(selectedDate).format('MMMM YYYY')}
          </span>
          <button
            onClick={() => setSelectedDate(moment(selectedDate).add(7, 'days').toDate())}
            className="p-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ChevronRight size={20} />
          </button>
        </div>
        
        <div className="flex space-x-2 overflow-x-auto pb-2">
          {dateRange.map((date) => (
            <button
              key={date.toISOString()}
              onClick={() => setSelectedDate(date)}
              className={`flex flex-col items-center justify-center min-w-[60px] h-16 px-2 py-2 rounded-lg transition-all duration-200 ${
                moment(date).isSame(selectedDate, 'day')
                  ? 'bg-blue-500 text-white shadow-lg'
                  : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              <span className="text-xs font-medium">
                {moment(date).format('ddd')}
              </span>
              <span className="text-lg font-bold">
                {moment(date).format('D')}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* All-Day Events Section */}
      <div className="mb-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg overflow-hidden">
          <div className="w-full p-3 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            All-Day Events
          </div>
          <div className="p-3">
            {selectedDateEvents.filter(event => event.allDay).length > 0 ? (
              selectedDateEvents
                .filter(event => event.allDay)
                .map((event) => (
                  <div
                    key={event.id}
                    onClick={() => handleEventClick(event)}
                    className="mb-2 p-3 rounded-lg text-white text-sm font-medium cursor-pointer transition-all duration-200 hover:opacity-80"
                    style={{ backgroundColor: getEventColor(event) }}
                  >
                    <div className="font-bold">{event.title}</div>
                    <div className="text-xs opacity-90">
                      All day • {event.resource.data.location ? `${event.resource.data.location} • ` : ''}
                      {event.resource.type === 'commitment' ? event.resource.data.category : 'Study Session'}
                    </div>
                  </div>
                ))
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400 py-2">No all-day events</div>
            )}
          </div>
        </div>
      </div>

      {/* Vertical Timeline */}
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto">
          {timeSlots.map((hour) => {
            const events = getEventsForTimeSlot(hour).filter(event => !event.allDay);
            return (
              <div key={hour} className="border-b border-gray-200 dark:border-gray-700">
                <div className="flex">
                  {/* Time Label */}
                  <div className="w-16 flex-shrink-0 p-3 text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800">
                    {formatTimeSlot(hour)}
                  </div>
                  
                  {/* Events - Now with drag and drop support */}
                  <TimeSlotDropZone hour={hour}>
                    {events.map((event) => (
                      <DraggableEvent
                        key={event.id}
                        event={event}
                        onEventClick={handleEventClick}
                      />
                    ))}
                  </TimeSlotDropZone>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-sm w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
                  {selectedEvent.title}
                </h3>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <X size={24} />
                </button>
              </div>
              
              <div className="space-y-3 mb-6">
                {!selectedEvent.allDay && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                    <Clock size={16} />
                    <span>
                      {moment(selectedEvent.start).format('h:mm A')} - {moment(selectedEvent.end).format('h:mm A')}
                    </span>
                  </div>
                )}
                
                {selectedEvent.allDay && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                    <Clock size={16} />
                    <span>All Day</span>
                  </div>
                )}
                
                {selectedEvent.resource.type === 'study' && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                    <BookOpen size={16} />
                    <span>Study Session</span>
                  </div>
                )}
                
                {selectedEvent.resource.type === 'commitment' && (
                  <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-300">
                    <Clock size={16} />
                    <span className="capitalize">{selectedEvent.resource.data.category}</span>
                  </div>
                )}
              </div>

              <div className="flex space-x-3">
                {selectedEvent.resource.type === 'commitment' && (
                  <>
                    <button
                      onClick={handleStartSession}
                      className="flex-1 bg-blue-500 text-white py-3 px-4 rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center space-x-2"
                    >
                      <Play size={16} />
                      <span>Start Session</span>
                    </button>
                    <button
                      onClick={handleDeleteSession}
                      className="flex-1 bg-red-500 text-white py-3 px-4 rounded-lg hover:bg-red-600 transition-colors flex items-center justify-center space-x-2"
                    >
                      <Trash2 size={16} />
                      <span>Delete</span>
                    </button>
                  </>
                )}
                
                {selectedEvent.resource.type === 'study' && onSelectTask && (
                  <button
                    onClick={() => {
                      onSelectTask(selectedEvent.resource.data.task, {
                        allocatedHours: selectedEvent.resource.data.session.allocatedHours,
                        planDate: moment(selectedDate).format('YYYY-MM-DD'),
                        sessionNumber: selectedEvent.resource.data.session.sessionNumber
                      });
                      setSelectedEvent(null);
                    }}
                    className="w-full bg-blue-500 text-white py-3 px-4 rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center space-x-2"
                  >
                    <Play size={16} />
                    <span>Start Study Session</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      </div>
    </DndProvider>
  );
};

export default MobileCalendarView;
