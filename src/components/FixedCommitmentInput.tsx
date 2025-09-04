import React, { useState, useMemo } from 'react';
import { Plus, Clock, MapPin, User, AlertTriangle, Calendar, Info, CheckCircle, XCircle } from 'lucide-react';
import { FixedCommitment, UserSettings, StudyPlan, DaySpecificTiming } from '../types';
import { checkCommitmentConflicts, doesCommitmentApplyToDate } from '../utils/scheduling';

// Utility function to convert hour number to HH:MM format
const formatHour = (hour: number): string => {
  return hour.toString().padStart(2, '0') + ':00';
};

// Helper function to get day name from day number
const getDayName = (dayNum: number): string => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayNum];
};

// Enhanced helper function to get commitments for a specific day with conflict detection
const getCommitmentsForDay = (dayOfWeek: number, commitments: FixedCommitment[], targetDate?: string): FixedCommitment[] => {
  return commitments.filter(commitment => {
    // Use the proper utility function to check if commitment applies to date
    if (targetDate) {
      return doesCommitmentApplyToDate(commitment, targetDate);
    }

    // Fallback for when no target date is provided
    if (commitment.recurring) {
      const dayMatches = commitment.daysOfWeek.includes(dayOfWeek);
      if (!dayMatches) return false;

      // Check date range if specified
      if (commitment.dateRange?.startDate && commitment.dateRange?.endDate) {
        const today = new Date().toISOString().split('T')[0];
        return today >= commitment.dateRange.startDate && today <= commitment.dateRange.endDate;
      }

      return true;
    } else {
      // For one-time commitments without target date, we can't determine applicability
      return false;
    }
  });
};

// Enhanced helper function to find optimal available time slots for a day
const findAvailableTimeSlots = (
  dayOfWeek: number,
  commitments: FixedCommitment[],
  studyPlans: StudyPlan[],
  settings: UserSettings,
  targetDate?: string
): { start: string; end: string; duration: number; isOptimal: boolean }[] => {
  const dayCommitments = getCommitmentsForDay(dayOfWeek, commitments, targetDate);
  const busySlots: { start: number; end: number; source: string }[] = [];

  // Convert time string to minutes for precise calculations
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  };

  const minutesToTime = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  // Add commitment time slots with conflict detection
  dayCommitments.forEach(commitment => {
    if (commitment.isAllDay) {
      // All-day commitments don't necessarily block time slots for most categories
      // Only block if it's a high-priority category that requires full attention
      const blockingCategories = ['Work', 'Academics'];
      if (blockingCategories.includes(commitment.category)) {
        busySlots.push({
          start: 0,
          end: 24 * 60 - 1,
          source: `${commitment.title} (All Day)`
        });
      }
    } else if (commitment.startTime && commitment.endTime) {
      // Handle day-specific timing if applicable
      let startTime = commitment.startTime;
      let endTime = commitment.endTime;

      if (commitment.useDaySpecificTiming && commitment.daySpecificTimings) {
        const dayTiming = commitment.daySpecificTimings.find(t => t.dayOfWeek === dayOfWeek);
        if (dayTiming && !dayTiming.isAllDay && dayTiming.startTime && dayTiming.endTime) {
          startTime = dayTiming.startTime;
          endTime = dayTiming.endTime;
        }
      }

      busySlots.push({
        start: timeToMinutes(startTime),
        end: timeToMinutes(endTime),
        source: commitment.title
      });
    }
  });

  // Add study sessions from existing plans for the target date
  if (targetDate) {
    const planForDate = studyPlans.find(plan => plan.date === targetDate);
    if (planForDate) {
      planForDate.plannedTasks.forEach(session => {
        if (session.startTime && session.endTime && !session.done && session.status !== 'skipped') {
          busySlots.push({
            start: timeToMinutes(session.startTime),
            end: timeToMinutes(session.endTime),
            source: `Study: ${session.taskId.substring(0, 20)}...`
          });
        }
      });
    }
  }

  // Sort busy slots by start time and merge overlapping slots
  busySlots.sort((a, b) => a.start - b.start);

  const mergedSlots: { start: number; end: number; source: string }[] = [];
  for (const slot of busySlots) {
    if (mergedSlots.length === 0 || mergedSlots[mergedSlots.length - 1].end < slot.start) {
      mergedSlots.push(slot);
    } else {
      // Merge overlapping slots
      const lastSlot = mergedSlots[mergedSlots.length - 1];
      lastSlot.end = Math.max(lastSlot.end, slot.end);
      lastSlot.source += ` + ${slot.source}`;
    }
  }

  // Find available time gaps and calculate optimal durations
  const availableSlots: { start: string; end: string; duration: number; isOptimal: boolean }[] = [];
  const workStart = (settings.studyWindowStartHour || 6) * 60;
  const workEnd = (settings.studyWindowEndHour || 23) * 60;
  const minSessionMinutes = settings.minSessionLength || 30; // Default 30 minutes minimum
  const maxSessionMinutes = (settings.maxSessionHours || 4) * 60; // Default 4 hours maximum

  let currentTime = workStart;

  // Check gaps between busy slots
  for (const busySlot of mergedSlots) {
    const gapDuration = busySlot.start - currentTime;

    if (gapDuration >= minSessionMinutes) {
      const optimalDuration = Math.min(gapDuration, maxSessionMinutes);
      const isOptimal = gapDuration >= 120; // 2+ hours is considered optimal

      availableSlots.push({
        start: minutesToTime(currentTime),
        end: minutesToTime(currentTime + optimalDuration),
        duration: optimalDuration / 60, // Convert back to hours
        isOptimal
      });
    }

    currentTime = Math.max(currentTime, busySlot.end);
  }

  // Check if there's time after the last commitment
  const finalGapDuration = workEnd - currentTime;
  if (finalGapDuration >= minSessionMinutes) {
    const optimalDuration = Math.min(finalGapDuration, maxSessionMinutes);
    const isOptimal = finalGapDuration >= 120; // 2+ hours is considered optimal

    availableSlots.push({
      start: minutesToTime(currentTime),
      end: minutesToTime(currentTime + optimalDuration),
      duration: optimalDuration / 60, // Convert back to hours
      isOptimal
    });
  }

  // Sort by optimal slots first, then by duration (largest first), then by start time
  availableSlots.sort((a, b) => {
    if (a.isOptimal !== b.isOptimal) return a.isOptimal ? -1 : 1;
    if (b.duration !== a.duration) return b.duration - a.duration;

    // Sort by start time chronologically (earlier times first)
    const toMinutes = (timeStr: string) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };
    return toMinutes(a.start) - toMinutes(b.start);
  });

  return availableSlots.slice(0, 4); // Return top 4 suggestions
};

interface FixedCommitmentInputProps {
  onAddCommitment: (commitment: Omit<FixedCommitment, 'id' | 'createdAt'>) => void;
  existingCommitments: FixedCommitment[];
  settings: UserSettings;
  existingPlans: StudyPlan[];
}

const FixedCommitmentInput: React.FC<FixedCommitmentInputProps> = ({
  onAddCommitment,
  existingCommitments,
  settings,
  existingPlans
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    startTime: '',
    endTime: '',
    recurring: true,
    daysOfWeek: [] as number[],
    specificDates: [] as string[],
    category: 'Academics',
    location: '',
    description: '',
    isAllDay: false,
    countsTowardDailyHours: false,
    useDaySpecificTiming: false,
    daySpecificTimings: [] as DaySpecificTiming[],
    dateRange: {
      startDate: '',
      endDate: ''
    }
  });

  const [conflictError, setConflictError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Compute preview data
  const previewData = useMemo(() => {
    if (!showPreview) return null;

    const selectedDays = formData.recurring ? formData.daysOfWeek : [];
    const previewInfo: {
      dayOfWeek: number;
      dayName: string;
      existingCommitments: FixedCommitment[];
      availableSlots: { start: string; end: string; duration: number; isOptimal: boolean }[];
      conflicts: FixedCommitment[];
    }[] = [];

    selectedDays.forEach(dayOfWeek => {
      const dayCommitments = getCommitmentsForDay(dayOfWeek, existingCommitments);
      const availableSlots = findAvailableTimeSlots(dayOfWeek, existingCommitments, existingPlans, settings,
        // Calculate target date for this day of week (next occurrence)
        (() => {
          const today = new Date();
          const todayDayOfWeek = today.getDay();
          const daysUntilTarget = (dayOfWeek - todayDayOfWeek + 7) % 7;
          const targetDate = new Date(today);
          targetDate.setDate(today.getDate() + (daysUntilTarget === 0 ? 7 : daysUntilTarget));
          return targetDate.toISOString().split('T')[0];
        })()
      );

      // Check for conflicts with current form data
      const conflicts: FixedCommitment[] = [];
      if (formData.startTime && formData.endTime && !formData.isAllDay) {
        dayCommitments.forEach(commitment => {
          if (!commitment.isAllDay && commitment.startTime && commitment.endTime) {
            const formStart = formData.startTime;
            const formEnd = formData.endTime;
            const commitStart = commitment.startTime;
            const commitEnd = commitment.endTime;

            // Check for time overlap
            if ((formStart < commitEnd && formEnd > commitStart)) {
              conflicts.push(commitment);
            }
          }
        });
      }

      previewInfo.push({
        dayOfWeek,
        dayName: getDayName(dayOfWeek),
        existingCommitments: dayCommitments,
        availableSlots,
        conflicts
      });
    });

    return previewInfo;
  }, [showPreview, formData.daysOfWeek, formData.startTime, formData.endTime, formData.isAllDay, formData.recurring, existingCommitments, existingPlans, settings]);

  // Enhanced validation for fixed commitments
  const isTitleValid = formData.title.trim().length > 0;
  const isTitleLengthValid = formData.title.trim().length <= 100;
  const isStartTimeValid = formData.isAllDay || formData.startTime.trim().length > 0;
  const isEndTimeValid = formData.isAllDay || formData.endTime.trim().length > 0;
  const isDaysValid = formData.recurring ? formData.daysOfWeek.length > 0 : true;
  const isDatesValid = !formData.recurring ? formData.specificDates.length > 0 : true;
  const isTimeRangeValid = formData.isAllDay || !formData.startTime || !formData.endTime ||
    formData.startTime < formData.endTime;
  const isLocationValid = !formData.location || formData.location.trim().length <= 200;
  const isDateRangeValid = !formData.recurring || !formData.dateRange.startDate || !formData.dateRange.endDate ||
    formData.dateRange.startDate <= formData.dateRange.endDate;

  // Day-specific timing validation
  const isDaySpecificTimingValid = !formData.useDaySpecificTiming ||
    (formData.daySpecificTimings.length > 0 &&
     formData.daySpecificTimings.every(timing =>
       timing.isAllDay || (timing.startTime && timing.endTime && timing.startTime < timing.endTime)
     ));

  const isFormValid = isTitleValid && isTitleLengthValid && isDaysValid &&
                          isDatesValid && isTimeRangeValid && isLocationValid && isDateRangeValid &&
                          isDaySpecificTimingValid &&
                          (formData.isAllDay || formData.useDaySpecificTiming || (isStartTimeValid && isEndTimeValid));



  const daysOfWeekOptions = [
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
    { value: 0, label: 'Sun' }
  ];


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    setConflictError(null);

    // Handle fixed commitment submission
    const conflictCheck = checkCommitmentConflicts(formData, existingCommitments);

    if (conflictCheck.hasConflict) {
      const conflictingCommitment = conflictCheck.conflictingCommitment!;
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let conflictDescription = '';

      if (conflictingCommitment.recurring) {
        const conflictingDays = conflictingCommitment.daysOfWeek.map(day => dayNames[day]).join(', ');
        conflictDescription = `(${conflictingDays}, ${conflictingCommitment.startTime}-${conflictingCommitment.endTime})`;
      } else {
        const conflictingDates = conflictingCommitment.specificDates?.map(date => new Date(date).toLocaleDateString()).join(', ') || '';
        conflictDescription = `(${conflictingDates}, ${conflictingCommitment.startTime}-${conflictingCommitment.endTime})`;
      }

      if (conflictCheck.conflictType === 'strict') {
        setConflictError(
          `Time conflict with "${conflictingCommitment.title}" ${conflictDescription}. Please adjust your schedule.`
        );
        return;
      } else if (conflictCheck.conflictType === 'override') {
        if (!formData.recurring) {
          setConflictError(
            `This one-time commitment will override the recurring commitment "${conflictingCommitment.title}" on the selected dates.`
          );
        } else {
          const conflictingDates = conflictCheck.conflictingDates?.map(date => new Date(date).toLocaleDateString()).join(', ') || '';
          setConflictError(
            `This recurring commitment conflicts with one-time commitments on: ${conflictingDates}. These dates will be excluded from the recurring schedule.`
          );
        }
      }
    }


    const commitmentData = {
      ...formData,
      type: 'fixed' as const,
      startTime: formData.isAllDay ? undefined : formData.startTime,
      endTime: formData.isAllDay ? undefined : formData.endTime,
      dateRange: (formData.recurring && formData.dateRange.startDate && formData.dateRange.endDate)
        ? formData.dateRange
        : undefined
    };

    onAddCommitment(commitmentData);

    // Reset form
    setFormData({
      title: '',
      startTime: '',
      endTime: '',
      recurring: true,
      daysOfWeek: [],
      specificDates: [],
      category: 'Academics',
      location: '',
      description: '',
      isAllDay: false,
      countsTowardDailyHours: false,
      useDaySpecificTiming: false,
      daySpecificTimings: [],
      dateRange: {
        startDate: '',
        endDate: ''
      }
    });
    setIsOpen(false);
  };

  const handleDayToggle = (day: number) => {
    setFormData(prev => {
      const newDaysOfWeek = prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter(d => d !== day)
        : [...prev.daysOfWeek, day].sort();

      // Update day-specific timings when days change
      let newDaySpecificTimings = prev.daySpecificTimings;
      if (prev.useDaySpecificTiming) {
        if (prev.daysOfWeek.includes(day) && !newDaysOfWeek.includes(day)) {
          // Day was removed, remove its timing
          newDaySpecificTimings = prev.daySpecificTimings.filter(timing => timing.dayOfWeek !== day);
        } else if (!prev.daysOfWeek.includes(day) && newDaysOfWeek.includes(day)) {
          // Day was added, add default timing
          newDaySpecificTimings = [...prev.daySpecificTimings, {
            dayOfWeek: day,
            startTime: '09:00',
            endTime: '10:00',
            isAllDay: false
          }].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
        }
      }

      return {
        ...prev,
        daysOfWeek: newDaysOfWeek,
        daySpecificTimings: newDaySpecificTimings
      };
    });
  };

  const handleDaySpecificTimingToggle = () => {
    setFormData(prev => {
      const useDaySpecificTiming = !prev.useDaySpecificTiming;
      let daySpecificTimings = prev.daySpecificTimings;

      if (useDaySpecificTiming && prev.daysOfWeek.length > 0) {
        // Initialize day-specific timings for selected days
        daySpecificTimings = prev.daysOfWeek.map(day => ({
          dayOfWeek: day,
          startTime: prev.startTime || '09:00',
          endTime: prev.endTime || '10:00',
          isAllDay: prev.isAllDay || false
        }));
      }

      return {
        ...prev,
        useDaySpecificTiming,
        daySpecificTimings
      };
    });
  };

  const updateDaySpecificTiming = (dayOfWeek: number, field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      daySpecificTimings: prev.daySpecificTimings.map(timing =>
        timing.dayOfWeek === dayOfWeek
          ? { ...timing, [field]: value }
          : timing
      )
    }));
  };



  return (
    <div className="bg-white rounded-xl shadow-lg p-6 dark:bg-gray-900 dark:shadow-gray-900">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
          Add Commitment
        </h2>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 flex items-center space-x-2 add-commitment-button"
        >
          <Plus size={20} />
          <span>Add Commitment</span>
        </button>
      </div>

      {isOpen && (
        <form onSubmit={handleSubmit} className="space-y-4">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                Title
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                placeholder="e.g., Linear Algebra Lecture"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                Category
              </label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 text-gray-400" size={20} />
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      category: e.target.value
                    })
                  }
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                >
                  <option value="Academics">Academics</option>
                  <option value="Work">Work</option>
                  <option value="Personal">Personal</option>
                  <option value="Health">Health</option>
                  <option value="Learning">Learning</option>
                  <option value="Finance">Finance</option>
                  <option value="Home">Home</option>
                  <option value="Organization">Organization</option>
                  <option value="Routine">Routine</option>
                  <option value="Buffer">Buffer</option>
                </select>
              </div>
                      </div>
        </div>


          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                Recurrence Pattern
              </label>
              <div className="flex space-x-4">
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="recurring"
                    checked={formData.recurring}
                    onChange={() => setFormData({ ...formData, recurring: true, specificDates: [] })}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-200">Recurring</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="recurring"
                    checked={!formData.recurring}
                    onChange={() => setFormData({ ...formData, recurring: false, daysOfWeek: [] })}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-200">One-time</span>
                </label>
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={formData.isAllDay}
                onChange={(e) => setFormData({ ...formData, isAllDay: e.target.checked })}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span>All-day event (no specific time)</span>
            </label>
          </div>

        {!formData.isAllDay && !formData.useDaySpecificTiming && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                Start Time
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-2.5 text-gray-400" size={20} />
                <input
                  type="time"
                  required={!formData.isAllDay && !formData.useDaySpecificTiming}
                  value={formData.startTime}
                  onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
                End Time
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-2.5 text-gray-400" size={20} />
                <input
                  type="time"
                  required={!formData.isAllDay && !formData.useDaySpecificTiming}
                  value={formData.endTime}
                  onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>
          </div>
        )}

        {formData.recurring && !formData.isAllDay && (
          <div className="mb-4">
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                checked={formData.useDaySpecificTiming}
                onChange={handleDaySpecificTimingToggle}
                className="text-blue-600 focus:ring-blue-500"
              />
              <span>Different times for different days</span>
            </label>
            <p className="text-xs text-gray-500 mt-1 dark:text-gray-400">
              Configure specific start and end times for each day of the week
            </p>
          </div>
        )}

        {formData.useDaySpecificTiming && formData.recurring && !formData.isAllDay && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
              <h4 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-3">
                Day-Specific Times
              </h4>
              <div className="space-y-3">
                {daysOfWeekOptions
                  .filter(day => formData.daysOfWeek.includes(day.value))
                  .map(day => {
                    const timing = formData.daySpecificTimings.find(t => t.dayOfWeek === day.value);
                    return (
                      <div key={day.value} className="flex items-center space-x-4">
                        <div className="w-12 text-sm font-medium text-gray-700 dark:text-gray-200">
                          {day.label}
                        </div>
                        <div className="flex items-center space-x-2 flex-1">
                          <label className="flex items-center space-x-1">
                            <input
                              type="checkbox"
                              checked={timing?.isAllDay || false}
                              onChange={(e) => updateDaySpecificTiming(day.value, 'isAllDay', e.target.checked)}
                              className="text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-xs text-gray-600 dark:text-gray-400">All day</span>
                          </label>
                          {!timing?.isAllDay && (
                            <>
                              <input
                                type="time"
                                value={timing?.startTime || ''}
                                onChange={(e) => updateDaySpecificTiming(day.value, 'startTime', e.target.value)}
                                className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white text-sm"
                                placeholder="Start"
                              />
                              <span className="text-gray-400">to</span>
                              <input
                                type="time"
                                value={timing?.endTime || ''}
                                onChange={(e) => updateDaySpecificTiming(day.value, 'endTime', e.target.value)}
                                className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white text-sm"
                                placeholder="End"
                              />
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
              {formData.daysOfWeek.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Select days of the week first to configure specific times
                </p>
              )}
            </div>
          </div>
        )}

                  {formData.recurring ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-200">
                Days of Week
              </label>
              <div className="flex flex-wrap gap-2">
                {daysOfWeekOptions.map((day) => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => handleDayToggle(day.value)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                      formData.daysOfWeek.includes(day.value)
                        ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule Preview Toggle */}
            {formData.daysOfWeek.length > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="flex items-center space-x-2 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 font-medium"
                >
                  <Info size={16} />
                  <span>{showPreview ? 'Hide' : 'Show'} Schedule Preview</span>
                </button>
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  View existing commitments and get scheduling suggestions for selected days
                </p>
              </div>
            )}

            {/* Schedule Preview */}
            {showPreview && previewData && previewData.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center space-x-2 mb-2">
                    <Calendar size={16} />
                    <span>Schedule Preview for Selected Days</span>
                  </h4>

                  {/* Summary */}
                  <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-white dark:bg-gray-700 rounded-lg">
                    <div className="text-center">
                      <div className="text-lg font-bold text-gray-800 dark:text-gray-200">
                        {previewData.reduce((sum, day) => sum + day.existingCommitments.length, 0)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Existing Commitments</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-green-600 dark:text-green-400">
                        {previewData.reduce((sum, day) => sum + day.availableSlots.length, 0)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Available Slots</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        {previewData.reduce((sum, day) => sum + day.availableSlots.filter(slot => slot.isOptimal).length, 0)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400">Optimal Slots (2h+)</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {previewData.map(dayInfo => (
                    <div key={dayInfo.dayOfWeek} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="font-medium text-gray-700 dark:text-gray-300">{dayInfo.dayName}</h5>
                        {dayInfo.conflicts.length > 0 && (
                          <div className="flex items-center space-x-1 text-red-600">
                            <XCircle size={14} />
                            <span className="text-xs">Conflicts detected</span>
                          </div>
                        )}
                      </div>

                      {/* Existing Commitments */}
                      {dayInfo.existingCommitments.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Existing Commitments:</p>
                          <div className="space-y-1">
                            {dayInfo.existingCommitments.map((commitment, idx) => (
                              <div key={idx} className={`text-xs p-2 rounded flex items-center justify-between ${
                                dayInfo.conflicts.includes(commitment)
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
                              }`}>
                                <span className="font-medium">{commitment.title}</span>
                                <span>
                                  {(() => {
                                    // Handle day-specific timings for commitments
                                    const dayTiming = commitment.useDaySpecificTiming && commitment.daySpecificTimings
                                      ? commitment.daySpecificTimings.find(t => t.dayOfWeek === dayInfo.dayOfWeek)
                                      : undefined;

                                    if (commitment.isAllDay || dayTiming?.isAllDay) return 'All Day';

                                    const start = dayTiming?.startTime ?? commitment.startTime;
                                    const end = dayTiming?.endTime ?? commitment.endTime;

                                    if (start && end) return `${start} - ${end}`;
                                    return 'Time not set';
                                  })()}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Available Time Slots */}
                      {dayInfo.availableSlots.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                            Suggested Time Slots ({dayInfo.availableSlots.length} available):
                          </p>
                          <div className="space-y-1">
                            {dayInfo.availableSlots.map((slot, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  if (formData.useDaySpecificTiming) {
                                    // Update day-specific timing for this day
                                    updateDaySpecificTiming(dayInfo.dayOfWeek, 'startTime', slot.start);
                                    updateDaySpecificTiming(dayInfo.dayOfWeek, 'endTime', slot.end);
                                  } else {
                                    // Update general timing
                                    setFormData(prev => ({
                                      ...prev,
                                      startTime: slot.start,
                                      endTime: slot.end
                                    }));
                                  }
                                }}
                                className={`w-full text-left text-xs px-3 py-2 rounded transition-colors duration-200 border ${
                                  slot.isOptimal
                                    ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30 dark:border-emerald-700'
                                    : 'bg-green-100 hover:bg-green-200 text-green-800 border-green-300 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/30 dark:border-green-700'
                                }`}
                                title={`${slot.isOptimal ? 'Optimal' : 'Good'} time slot: ${slot.duration.toFixed(1)}h available. Click to set as ${formData.useDaySpecificTiming ? dayInfo.dayName : 'general'} time`}
                              >
                                <div className="flex justify-between items-center">
                                  <span className="font-medium">{slot.start} - {slot.end}</span>
                                  <div className="flex items-center space-x-1">
                                    <span className="text-xs opacity-75">{slot.duration.toFixed(1)}h max</span>
                                    {slot.isOptimal && (
                                      <span className="bg-emerald-600 text-white text-xs px-1 rounded dark:bg-emerald-500">✓ Optimal</span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            💡 Optimal slots (2+ hours) are highlighted. Durations show maximum time available.
                          </p>
                        </div>
                      )}

                      {/* No conflicts indicator */}
                      {dayInfo.existingCommitments.length === 0 && (
                        <div className="flex items-center space-x-1 text-green-600">
                          <CheckCircle size={14} />
                          <span className="text-xs">No existing commitments - free to schedule anytime</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Daily Capacity Info */}
                {settings && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                    <div className="flex items-center space-x-2 mb-2">
                      <Clock size={14} className="text-blue-600 dark:text-blue-400" />
                      <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Daily Capacity Info</span>
                    </div>
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Your study window: {formatHour(settings.studyWindowStartHour || 6)} - {formatHour(settings.studyWindowEndHour || 23)}
                    </p>
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      Daily available hours: {settings.dailyAvailableHours}h
                                          </p>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-200">
                Date Range (Optional)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1 dark:text-gray-400">
                    Start Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 text-gray-400" size={20} />
                    <input
                      type="date"
                      value={formData.dateRange.startDate}
                      onChange={(e) => setFormData({
                        ...formData,
                        dateRange: {
                          ...formData.dateRange,
                          startDate: e.target.value
                        }
                      })}
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1 dark:text-gray-400">
                    End Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 text-gray-400" size={20} />
                    <input
                      type="date"
                      value={formData.dateRange.endDate}
                      onChange={(e) => setFormData({
                        ...formData,
                        dateRange: {
                          ...formData.dateRange,
                          endDate: e.target.value
                        }
                      })}
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                If no date range is specified, the commitment will recur indefinitely.
              </p>
            </div>
          </div>
        ) : !formData.recurring ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2 dark:text-gray-200">
              Specific Dates
            </label>
            <div className="space-y-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                <div className="flex items-center space-x-2 mb-2">
                  <Calendar className="text-blue-500 dark:text-blue-400" size={20} />
                  <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Select dates for this commitment</span>
                </div>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  Choose each date when this commitment occurs.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                  <Calendar className="absolute left-3 top-2.5 text-gray-400" size={20} />
                  <input
                    type="date"
                    key={formData.specificDates.length} // This will reset the input after each date is added
                    min={new Date().toISOString().split('T')[0]} // Prevent selecting past dates
                    onChange={(e) => {
                      if (e.target.value && !formData.specificDates.includes(e.target.value)) {
                        setFormData({
                          ...formData,
                          specificDates: [...formData.specificDates, e.target.value].sort()
                        });
                        // Reset the input by changing its key (handled above)
                      }
                    }}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                    placeholder="Select a date"
                  />
                </div>
                <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">Click to add</span>
              </div>

              {formData.specificDates.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      Selected Dates ({formData.specificDates.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, specificDates: [] })}
                      className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                    {formData.specificDates.map((date) => (
                      <div
                        key={date}
                        className="flex items-center justify-between bg-blue-100 text-blue-800 px-3 py-2 rounded-lg dark:bg-blue-900/20 dark:text-blue-300"
                      >
                        <span className="text-sm font-medium">{new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                        <button
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            specificDates: formData.specificDates.filter(d => d !== date)
                          })}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 font-bold text-lg leading-none"
                          title="Remove this date"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

          <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
              Location (Optional)
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-2.5 text-gray-400" size={20} />
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                placeholder="e.g., Room 101, Main Building"
              />
            </div>
          </div>

          <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-gray-200">
              Description (Optional)
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              rows={2}
              placeholder="Additional notes about this commitment..."
            />
          </div>


          {/* Conflict Error Display */}
          {conflictError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg dark:bg-red-900/20 dark:border-red-700">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="text-red-500 mt-0.5" size={16} />
                <span className="text-sm text-red-700 dark:text-red-300">{conflictError}</span>
              </div>
            </div>
          )}

          <div className="flex space-x-3">
            <button
              type="submit"
              disabled={!isFormValid}
              className="bg-gradient-to-r from-green-500 to-blue-600 text-white px-6 py-2 rounded-lg hover:from-green-600 hover:to-blue-700 transition-all duration-200 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={20} />
              <span>
                Add Commitment
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="bg-gray-200 text-gray-700 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors duration-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default FixedCommitmentInput;
