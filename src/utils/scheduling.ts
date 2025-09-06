import { Task, StudyPlan, StudySession, UserSettings, FixedCommitment, UserReschedule, DateSpecificStudyWindow, DaySpecificStudyHours, SkipMetadata } from '../types';

// Helper function to get day-specific daily hours
export const getDaySpecificDailyHours = (date: string, settings: UserSettings): number => {
  const targetDate = new Date(date);
  const dayOfWeek = targetDate.getDay();

  // Check for day-specific study hours
  if (settings.daySpecificStudyHours) {
    const daySpecific = settings.daySpecificStudyHours.find(
      hours => hours.dayOfWeek === dayOfWeek && hours.isActive
    );
    if (daySpecific) {
      return daySpecific.studyHours;
    }
  }

  // Fall back to default daily available hours
  return settings.dailyAvailableHours;
};

// Helper function to calculate committed hours for a specific date that count toward daily hours
export const calculateCommittedHoursForDate = (date: string, commitments: FixedCommitment[]): number => {
  // Sum durations (in hours) of commitments that apply to the date and count toward daily hours
  // Note: All-day commitments are ignored here for capacity subtraction to avoid over-restricting the day
  // since daily capacity logic already considers study windows. Modified occurrences and day-specific timings are respected.
  const toMinutes = (t?: string) => {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  let totalMinutes = 0;

  const applicable = commitments.filter(c => c.countsTowardDailyHours && doesCommitmentApplyToDate(c, date));

  for (const c of applicable) {
    // Determine occurrence for this date (consider modified occurrences and day-specific timings)
    let isAllDay = !!c.isAllDay;
    let startTime = c.startTime;
    let endTime = c.endTime;

    const mod = c.modifiedOccurrences?.[date];
    if (mod) {
      if (typeof mod.isAllDay === 'boolean') isAllDay = mod.isAllDay;
      if (mod.startTime) startTime = mod.startTime;
      if (mod.endTime) endTime = mod.endTime;
    } else if (c.useDaySpecificTiming && c.daySpecificTimings) {
      const dow = new Date(date).getDay();
      const timing = c.daySpecificTimings.find(t => t.dayOfWeek === dow);
      if (timing) {
        if (typeof timing.isAllDay === 'boolean') isAllDay = timing.isAllDay;
        startTime = timing.startTime || startTime;
        endTime = timing.endTime || endTime;
      }
    }

    // Skip all-day for capacity subtraction to avoid wiping the day
    if (isAllDay) {
      continue;
    }

    if (startTime && endTime) {
      const dur = Math.max(0, toMinutes(endTime) - toMinutes(startTime));
      totalMinutes += dur;
    }
  }

  return Math.round((totalMinutes / 60) * 1000) / 1000; // hours, rounded to 0.001h
};

// Utility functions
export const getLocalDateString = (): string => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Utility function to calculate total study hours for a plan, including skipped sessions as "done"
 * @param plannedTasks Array of study sessions
 * @returns Total study hours including both completed and skipped sessions
 * Note: Skipped sessions are included to reduce remaining estimated hours and prevent redistribution
 */
export const calculateTotalStudyHours = (plannedTasks: StudySession[]): number => {
  return plannedTasks
    .filter(session => session.done || session.status === 'skipped')
    .reduce((sum, session) => sum + session.allocatedHours, 0);
};

/**
 * Utility function to filter out skipped sessions from an array of sessions
 * @param sessions Array of study sessions
 * @returns Array of sessions excluding skipped ones
 */
export const filterSkippedSessions = (sessions: StudySession[]): StudySession[] => {
  return sessions.filter(session => session.status !== 'skipped');
};

export const formatTime = (hours: number): string => {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export const formatTimeForTimer = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) {
    return `${h}h${m > 0 ? ` ${m}m` : ''}`;
  } else {
    return `${m}m`;
  }
};

/**
 * Check if a task's deadline has passed
 * @param deadline The task deadline string (YYYY-MM-DD format)
 * @returns true if the deadline has passed, false otherwise
 */
export const isTaskDeadlinePast = (deadline: string): boolean => {
  const now = new Date();
  const deadlineDate = new Date(deadline);

  // Reset time to start of day for accurate comparison
  now.setHours(0, 0, 0, 0);
  deadlineDate.setHours(0, 0, 0, 0);

  return deadlineDate < now;
};

/**
 * Get the effective study window for a specific date
 * Takes into account date-specific overrides if they exist
 * @param date The date string (YYYY-MM-DD format) to get the study window for
 * @param settings User settings containing default and date-specific study windows
 * @returns Object with startHour and endHour for the effective study window
 */
export const getEffectiveStudyWindow = (
  date: string,
  settings: UserSettings
): { startHour: number; endHour: number } => {
  // Check if there's a date-specific study window for this date (highest priority)
  if (settings.dateSpecificStudyWindows) {
    const dateSpecificWindow = settings.dateSpecificStudyWindows.find(
      window => window.date === date && window.isActive
    );

    if (dateSpecificWindow) {
      return {
        startHour: dateSpecificWindow.startHour,
        endHour: dateSpecificWindow.endHour
      };
    }
  }

  // Check if there's a day-specific study window for this day of the week (medium priority)
  if (settings.daySpecificStudyWindows) {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();
    const daySpecificWindow = settings.daySpecificStudyWindows.find(
      window => window.dayOfWeek === dayOfWeek && window.isActive
    );

    if (daySpecificWindow) {
      return {
        startHour: daySpecificWindow.startHour,
        endHour: daySpecificWindow.endHour
      };
    }
  }

  // Return default study window (lowest priority)
  return {
    startHour: settings.studyWindowStartHour || 6,
    endHour: settings.studyWindowEndHour || 23
  };
};

/**
 * Check if a commitment applies to a specific date
 * @param commitment The commitment to check
 * @param date The date string to check (YYYY-MM-DD format)
 * @returns true if the commitment applies to the given date
 */
export const doesCommitmentApplyToDate = (commitment: FixedCommitment, date: string): boolean => {
  // Check if this occurrence was deleted
  if (commitment.deletedOccurrences?.includes(date)) {
    return false;
  }

  // Check if commitment applies to this date
  if (commitment.recurring) {
    // For recurring commitments, check if the day of week matches
    const dayOfWeekMatches = commitment.daysOfWeek.includes(new Date(date).getDay());
    
    // If day of week doesn't match, return false immediately
    if (!dayOfWeekMatches) return false;
    
    // CRITICAL FIX: If there's a date range specified, the commitment ONLY applies within that range
    if (commitment.dateRange?.startDate && commitment.dateRange?.endDate) {
      // Only apply if the date is within the specified range
      // Add one day to endDate to include the full last day
      const endDateObj = new Date(commitment.dateRange.endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      const inclusiveEndDate = endDateObj.toISOString().split('T')[0];
      return date >= commitment.dateRange.startDate && date < inclusiveEndDate;
    }
    
    // No date range specified, so it applies to all dates with matching day of week
    return true;
  } else {
    // For non-recurring commitments, check if the specific date matches
    return commitment.specificDates?.includes(date) || false;
  }
};

/**
 * Calculate smart session distribution based on deadline pressure
 * @param task Task to analyze
 * @param settings User settings
 * @returns Distribution strategy and session information
 */
export const calculateSessionDistribution = (
  task: Pick<Task, 'deadline' | 'estimatedHours' | 'sessionDuration' | 'deadlineType' | 'startDate'>,
  settings: UserSettings
): {
  suggestedFrequency: 'urgent' | 'moderate' | 'relaxed';
  description: string;
  estimatedSessions: number;
  daysAvailable?: number;
} => {
  const sessionDuration = task.sessionDuration || 2;
  const estimatedSessions = Math.ceil(task.estimatedHours / sessionDuration);

  if (!task.deadline || task.deadlineType === 'none') {
    return {
      suggestedFrequency: 'relaxed',
      description: 'Sessions will be distributed based on available time slots',
      estimatedSessions
    };
  }

  const startDate = new Date(task.startDate || new Date().toISOString().split('T')[0]);
  const deadlineDate = new Date(task.deadline);
  const timeDiff = deadlineDate.getTime() - startDate.getTime();
  const daysUntilDeadline = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

  let suggestedFrequency: 'urgent' | 'moderate' | 'relaxed';
  let description: string;

  if (daysUntilDeadline < 7) {
    suggestedFrequency = 'urgent';
    description = 'Daily sessions recommended due to urgent deadline';
  } else if (daysUntilDeadline < 14) {
    suggestedFrequency = 'moderate';
    description = 'Every other day sessions recommended';
  } else {
    suggestedFrequency = 'relaxed';
    description = '2-3 sessions per week recommended';
  }

  return {
    suggestedFrequency,
    description,
    estimatedSessions,
    daysAvailable: daysUntilDeadline
  };
};

export const checkSessionStatus = (session: StudySession, planDate: string): 'scheduled' | 'in_progress' | 'completed' => {
  const now = new Date();
  const today = getLocalDateString();
  const sessionStartTime = new Date(`${planDate}T${session.startTime}:00`);
  const sessionEndTime = new Date(`${planDate}T${session.endTime}:00`);

  // Check completion status first
  if (session.done || session.status === 'completed' || session.status === 'skipped') {
    return 'completed';
  }

  // For today's sessions, check if they're in progress
  if (planDate === today) {
    if (now >= sessionStartTime && now <= sessionEndTime) {
      return 'in_progress';
    }
  }

  // All other sessions (past, present, future) are simply 'scheduled'
  // Past sessions are ignored rather than marked as missed
  return 'scheduled';
};

/**
 * Automatically mark sessions as skipped if their day has passed and they're not completed
 * @param studyPlans Array of study plans to check
 * @returns Updated study plans with past incomplete sessions marked as skipped
 */
export const markPastSessionsAsSkipped = (studyPlans: StudyPlan[]): StudyPlan[] => {
  const today = getLocalDateString();

  return studyPlans.map(plan => {
    // Only process plans for dates before today
    if (plan.date >= today) {
      return plan;
    }

    return {
      ...plan,
      plannedTasks: plan.plannedTasks.map(session => {
        // Skip sessions that are already done, completed, or skipped
        if (session.done || session.status === 'completed' || session.status === 'skipped') {
          return session;
        }

        // Mark remaining sessions as skipped with metadata
        return {
          ...session,
          status: 'skipped' as const,
          skipMetadata: {
            skippedAt: new Date().toISOString(),
            reason: 'overload' // System automatically skipped due to date passing
          }
        };
      })
    };
  });
};


/**
 * Check if frequency preferences conflict with deadline requirements
 * @param task Task to check
 * @param settings User settings
 * @param fixedCommitments Fixed commitments
 * @param dailyRemainingHours Available hours per day
 * @returns Object indicating if there's a conflict
 */
const checkFrequencyDeadlineConflict = (
  task: Task,
  settings: UserSettings,
  fixedCommitments: FixedCommitment[],
  dailyRemainingHours: { [date: string]: number }
): { hasConflict: boolean; reason?: string } => {
  if (!task.targetFrequency || !task.deadline) {
    return { hasConflict: false };
  }

  const now = new Date();
  const deadline = new Date(task.deadline);
  if (settings.bufferDays > 0) {
    deadline.setDate(deadline.getDate() - settings.bufferDays);
  }

  const startDate = task.startDate ? new Date(task.startDate) : now;
  const timeDiff = deadline.getTime() - startDate.getTime();
  const totalDaysAvailable = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

  // Calculate how many sessions the frequency preference would allow
  let expectedSessions = 0;
  switch (task.targetFrequency) {
    case 'daily':
      expectedSessions = totalDaysAvailable;
      break;
    case '3x-week':
      expectedSessions = Math.floor(totalDaysAvailable / 7) * 3;
      break;
    case 'weekly':
      expectedSessions = Math.floor(totalDaysAvailable / 7);
      break;
    case 'flexible':
      expectedSessions = Math.floor(totalDaysAvailable / 2); // Every other day
      break;
    default:
      expectedSessions = totalDaysAvailable;
  }

  // Check if the expected sessions can accommodate the task hours
  const maxSessionLength = settings.maxSessionHours || 4;
  const maxPossibleHours = expectedSessions * maxSessionLength;

  if (maxPossibleHours < task.estimatedHours) {
    return {
      hasConflict: true,
      reason: `Task requires ${task.estimatedHours}h but ${task.targetFrequency} frequency only allows ${maxPossibleHours}h`
    };
  }

  return { hasConflict: false };
};

/**
 * Redistribute compromised session duration to other existing sessions of the same task
 * @param compromisedSession The session that needs redistribution
 * @param otherSessions Other sessions of the same task that can absorb extra hours
 * @param maxSessionLength Maximum session length allowed
 * @param dailyRemainingHours Available hours per day
 * @returns Updated sessions with redistributed hours
 */
const redistributeCompromisedSession = (
  compromisedSession: StudySession,
  otherSessions: StudySession[],
  maxSessionLength: number,
  dailyRemainingHours: { [date: string]: number }
): { redistributedSessions: StudySession[]; remainingHours: number } => {
  const hoursToRedistribute = compromisedSession.allocatedHours;
  let remainingHours = hoursToRedistribute;
  const redistributedSessions: StudySession[] = [];

  // Sort other sessions by available capacity (how much they can grow)
  const sessionsWithCapacity = otherSessions
    .map(session => {
      const sessionDate = session.scheduledTime;
      const currentDayHours = dailyRemainingHours[sessionDate] || 0;
      const maxGrowth = Math.min(
        maxSessionLength - session.allocatedHours, // Don't exceed max session length
        currentDayHours // Don't exceed available hours for that day
      );
      return { session, maxGrowth };
    })
    .filter(item => item.maxGrowth > 0)
    .sort((a, b) => b.maxGrowth - a.maxGrowth); // Sort by capacity descending

  // Distribute hours to sessions that can accommodate them
  for (const { session, maxGrowth } of sessionsWithCapacity) {
    if (remainingHours <= 0) break;

    const hoursToAdd = Math.min(remainingHours, maxGrowth);
    if (hoursToAdd > 0) {
      const sessionDate = session.scheduledTime;
      const updatedSession = {
        ...session,
        allocatedHours: session.allocatedHours + hoursToAdd
      };

      // Update remaining hours for that day
      dailyRemainingHours[sessionDate] -= hoursToAdd;
      remainingHours -= hoursToAdd;

      redistributedSessions.push(updatedSession);
    } else {
      redistributedSessions.push(session);
    }
  }

  // Add any sessions that couldn't be modified
  otherSessions.forEach(session => {
    if (!redistributedSessions.find(rs => rs === session ||
        (rs.taskId === session.taskId && rs.scheduledTime === session.scheduledTime && rs.sessionNumber === session.sessionNumber))) {
      redistributedSessions.push(session);
    }
  });

  return { redistributedSessions, remainingHours };
};

// Helper function to optimize session distribution by trying to create larger sessions
const optimizeSessionDistribution = (task: Task, totalHours: number, daysForTask: string[], settings: UserSettings) => {
  const minSessionLength = (settings.minSessionLength || 15) / 60; // in hours
  const maxSessionLength = Math.min(4, settings.dailyAvailableHours); // Cap at 4 hours or daily limit

  // For one-time tasks, return a single session with all hours
  // Note: Scheduling timing is handled in the distribution loop:
  // - High-impact one-sitting tasks: scheduled early (maximum priority)
  // - Regular one-sitting tasks: scheduled on deadline day (respecting buffer), or closest available day
  if (task.isOneTimeTask) {
    return [totalHours];
  }

  // If task has a preferred session duration (from session-based estimation), use it
  if (task.preferredSessionDuration && task.preferredSessionDuration > 0) {
    const preferredDuration = task.preferredSessionDuration;
    const numNeededSessions = Math.ceil(totalHours / preferredDuration);

    // If we have enough days for the needed sessions, use preferred duration
    if (numNeededSessions <= daysForTask.length) {
      const sessions: number[] = [];
      let remainingHours = totalHours;

      for (let i = 0; i < numNeededSessions && remainingHours > 0; i++) {
        const sessionLength = Math.min(preferredDuration, remainingHours);
        if (sessionLength >= minSessionLength) {
          sessions.push(sessionLength);
          remainingHours -= sessionLength;
        }
      }

      return sessions;
    }
    // If not enough days, fall through to default distribution
  }

  // Try to create fewer, larger sessions
  let optimalSessions: number[] = [];
  let remainingHours = totalHours;

  // Calculate how many sessions we can create with minimum length
  const maxSessionsWithMinLength = Math.floor(totalHours / minSessionLength);

  // Determine optimal number of sessions
  let numSessions = Math.min(daysForTask.length, maxSessionsWithMinLength);

  if (numSessions === 0) {
    // If we can't meet minimum session length, create one session per day
    numSessions = daysForTask.length;
  }

  // Create sessions with preference for larger sessions
  for (let i = 0; i < numSessions && remainingHours > 0; i++) {
    const sessionLength = Math.min(
      remainingHours / (numSessions - i), // Distribute remaining hours evenly
      maxSessionLength, // Don't exceed max session length
      remainingHours // Don't exceed remaining hours
    );

    if (sessionLength >= minSessionLength) {
      optimalSessions.push(sessionLength);
      remainingHours -= sessionLength;
    }
  }

  // If we have remaining hours, add them to the first session
  if (remainingHours > 0 && optimalSessions.length > 0) {
    optimalSessions[0] += remainingHours;
  }

  return optimalSessions;
};

// Remove calculatePriorityScore, calculateTaskPriorityScore, and TaskWithPriority

// Helper to find the next available time slot for a session on a given day
export function findNextAvailableTimeSlot(
  requiredHours: number,
  existingSessions: StudySession[],
  commitments: FixedCommitment[],
  studyWindowStartHour: number,
  studyWindowEndHour: number,
  bufferTimeBetweenSessions: number = 0, // new param, in minutes
  targetDate?: string, // Add target date for filtering deleted occurrences
  settings?: UserSettings // Add settings to get date-specific study window
): { start: string; end: string } | null {
  // Use date-specific study window if available
  let effectiveStartHour = studyWindowStartHour;
  let effectiveEndHour = studyWindowEndHour;
  
  if (settings && targetDate) {
    const effectiveWindow = getEffectiveStudyWindow(targetDate, settings);
    effectiveStartHour = effectiveWindow.startHour;
    effectiveEndHour = effectiveWindow.endHour;
  }
  // Build a list of all busy intervals (sessions and commitments)
  // Exclude completed sessions as they don't block new scheduling
  const busyIntervals: Array<{ start: number; end: number }> = [];
  existingSessions.forEach(s => {
    // Skip completed sessions as they don't block new time slots
    if (!s.done && s.status !== 'completed') {
      const [sh, sm] = s.startTime.split(":").map(Number);
      const [eh, em] = s.endTime.split(":").map(Number);
      busyIntervals.push({ start: sh * 60 + (sm || 0), end: eh * 60 + (em || 0) });
    }
  });
  
  // Filter commitments to exclude deleted occurrences and check date range applicability
  const activeCommitments = commitments.filter(commitment => {
    if (!targetDate) return true; // If no target date, include all commitments
    
    // Use the proper function to check if commitment applies to this date
    return doesCommitmentApplyToDate(commitment, targetDate);
  });
  
  activeCommitments.forEach(c => {
    // Handle all-day events - removed blocking logic for work categories
    if (c.isAllDay) {
      // All-day events no longer block study session scheduling
      return;
    }
    
    // Determine the actual start and end times for this commitment on this date
    let actualStartTime = c.startTime;
    let actualEndTime = c.endTime;

    // First check for manual overrides (modifiedOccurrences)
    if (targetDate && c.modifiedOccurrences?.[targetDate]) {
      const modified = c.modifiedOccurrences[targetDate];

      // Check if the modified occurrence is an all-day event
      if (modified.isAllDay) {
        busyIntervals.push({ start: 0, end: 24 * 60 - 1 });
        return;
      }

      // Use modified times if available
      if (modified.startTime && modified.endTime) {
        actualStartTime = modified.startTime;
        actualEndTime = modified.endTime;
      }
    }
    // If no manual override, check for day-specific timing
    else if (c.useDaySpecificTiming && c.daySpecificTimings && targetDate) {
      const targetDayOfWeek = new Date(targetDate).getDay();
      const daySpecificTiming = c.daySpecificTimings.find(t => t.dayOfWeek === targetDayOfWeek);

      if (daySpecificTiming) {
        if (daySpecificTiming.isAllDay) {
          busyIntervals.push({ start: 0, end: 24 * 60 - 1 });
          return;
        } else if (daySpecificTiming.startTime && daySpecificTiming.endTime) {
          actualStartTime = daySpecificTiming.startTime;
          actualEndTime = daySpecificTiming.endTime;
        }
      }
    }

    // Add busy interval if we have valid times
    if (actualStartTime && actualEndTime) {
      const [sh, sm] = actualStartTime.split(":").map(Number);
      const [eh, em] = actualEndTime.split(":").map(Number);
      busyIntervals.push({ start: sh * 60 + (sm || 0), end: eh * 60 + (em || 0) });
    }
  });
  
  busyIntervals.sort((a, b) => a.start - b.start);
// Enhanced logic to find first available slot with better precision
const requiredMinutes = Math.round(requiredHours * 60); // Use round instead of ceil for better precision
let current = effectiveStartHour * 60;
const endOfDay = effectiveEndHour * 60;

// Simple debug logging (console only)
const debugLog = (message: string, data?: any) => {
  // Only log to console in development
  if (process.env.NODE_ENV === 'development') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] ${message}`, data || '');
  }
};

if (targetDate) {
  debugLog(`Finding slot for ${requiredHours}h (${requiredMinutes}min) on ${targetDate}`);
  debugLog(`Study window: ${effectiveStartHour}:00 - ${effectiveEndHour}:00 (${current}-${endOfDay} minutes)`);
  debugLog(`Busy intervals:`, busyIntervals.map(i => `${Math.floor(i.start/60)}:${String(i.start%60).padStart(2,'0')}-${Math.floor(i.end/60)}:${String(i.end%60).padStart(2,'0')}`));
}

// Check gaps between busy intervals
for (const interval of busyIntervals) {
  const availableGap = interval.start - current;
  
  if (targetDate) {
    debugLog(`Checking gap: ${Math.floor(current/60)}:${String(current%60).padStart(2,'0')} to ${Math.floor(interval.start/60)}:${String(interval.start%60).padStart(2,'0')} = ${availableGap} minutes (need ${requiredMinutes})`);
  }
  
  if (availableGap >= requiredMinutes) {
    // Found a gap that fits - use it immediately
    const startH = Math.floor(current / 60).toString().padStart(2, '0');
    const startM = (current % 60).toString().padStart(2, '0');
    const endTime = current + requiredMinutes;
    const endH = Math.floor(endTime / 60).toString().padStart(2, '0');
    const endM = (endTime % 60).toString().padStart(2, '0');
    
    if (targetDate) {
      debugLog(`Found slot: ${startH}:${startM} - ${endH}:${endM}`);
    }
    
    return { start: `${startH}:${startM}`, end: `${endH}:${endM}` };
  }
  current = Math.max(current, interval.end + bufferTimeBetweenSessions);
}

// Check if there's space at the end of the day
const finalGap = endOfDay - current;
if (targetDate) {
  debugLog(`Checking final gap: ${Math.floor(current/60)}:${String(current%60).padStart(2,'0')} to ${Math.floor(endOfDay/60)}:${String(endOfDay%60).padStart(2,'0')} = ${finalGap} minutes (need ${requiredMinutes})`);
}

if (finalGap >= requiredMinutes) {
  const startH = Math.floor(current / 60).toString().padStart(2, '0');
  const startM = (current % 60).toString().padStart(2, '0');
  const endTime = current + requiredMinutes;
  const endH = Math.floor(endTime / 60).toString().padStart(2, '0');
  const endM = (endTime % 60).toString().padStart(2, '0');
  
  if (targetDate) {
    debugLog(`Found final slot: ${startH}:${startM} - ${endH}:${endM}`);
  }
  
  return { start: `${startH}:${startM}`, end: `${endH}:${endM}` };
}

if (targetDate) {
  debugLog(`No available slot found for ${requiredHours}h session`);
}

return null; // No available slot
}

// Helper function to validate that sessions don't overlap with each other or commitments
function validateSessionTimes(
  sessions: StudySession[],
  commitments: FixedCommitment[],
  date: string
): boolean {
  const timeToMinutes = (timeStr: string): number => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  };

  // Create a list of all busy intervals
  const busyIntervals: Array<{ start: number; end: number; source: string }> = [];

  // Add commitment intervals
  commitments.forEach(commitment => {
    let appliesToDate = false;
    if (commitment.recurring) {
      // Check day of week match
      const dayOfWeekMatches = commitment.daysOfWeek.includes(new Date(date).getDay());
      
      if (dayOfWeekMatches) {
        // Check date range if specified
        if (commitment.dateRange?.startDate && commitment.dateRange?.endDate) {
          // Add one day to endDate to include the full last day
          const endDateObj = new Date(commitment.dateRange.endDate);
          endDateObj.setDate(endDateObj.getDate() + 1);
          const inclusiveEndDate = endDateObj.toISOString().split('T')[0];
          appliesToDate = date >= commitment.dateRange.startDate && date < inclusiveEndDate;
        } else {
          appliesToDate = true;
        }
      }
    } else {
      appliesToDate = commitment.specificDates?.includes(date) || false;
    }

    if (appliesToDate && !commitment.deletedOccurrences?.includes(date)) {
      // Check for modified occurrences
      const modified = commitment.modifiedOccurrences?.[date];
      
      // Check if the commitment or its modification is an all-day event
      const isAllDay = modified?.isAllDay !== undefined ? modified.isAllDay : commitment.isAllDay;
      
      // For all-day events, block the entire day
      if (isAllDay) {
        busyIntervals.push({
          start: 0,
          end: 24 * 60 - 1,
          source: `commitment-${commitment.title}-allday`
        });
      } else {
        // For time-specific events, use the specified times
        const startTime = modified?.startTime || commitment.startTime;
        const endTime = modified?.endTime || commitment.endTime;
        
        if (startTime && endTime) {
          busyIntervals.push({
            start: timeToMinutes(startTime),
            end: timeToMinutes(endTime),
            source: `commitment-${commitment.title}`
          });
        }
      }
    }
  });

  // Add session intervals
  sessions.forEach((session, index) => {
    if (session.startTime && session.endTime) {
      busyIntervals.push({
        start: timeToMinutes(session.startTime),
        end: timeToMinutes(session.endTime),
        source: `session-${index}`
      });
    }
  });

  // Check for overlaps
  busyIntervals.sort((a, b) => a.start - b.start);
  for (let i = 0; i < busyIntervals.length - 1; i++) {
    const current = busyIntervals[i];
    const next = busyIntervals[i + 1];
    
    if (current.end > next.start) {
      console.warn(`Overlap detected on ${date}: ${current.source} (${current.start}-${current.end}) overlaps with ${next.source} (${next.start}-${next.end})`);
      return false;
    }
  }

  return true;
}

/**
 * Reshuffle existing study plan to balance workload across available days
 * Preserves session durations and organization while respecting deadlines and frequency preferences
 * @param existingStudyPlans Current study plans to reshuffle
 * @param tasks All tasks for reference
 * @param settings User settings
 * @param fixedCommitments Fixed commitments to avoid conflicts
 * @returns Reshuffled study plans with balanced workload distribution
 */
export const reshuffleStudyPlan = (
  existingStudyPlans: StudyPlan[],
  tasks: Task[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[]
): { plans: StudyPlan[]; suggestions: Array<{ taskTitle: string; unscheduledMinutes: number }> } => {
  if (existingStudyPlans.length === 0) {
    return { plans: [], suggestions: [] };
  }

  // Step 1: Extract all sessions from existing plans (excluding completed/skipped)
  const allSessions: Array<{
    session: StudySession;
    originalDate: string;
    task: Task;
  }> = [];

  for (const plan of existingStudyPlans) {
    for (const session of plan.plannedTasks) {
      // Skip completed, skipped, or done sessions - they shouldn't be moved
      if (session.done || session.status === 'completed' || session.status === 'skipped') {
        continue;
      }

      const task = tasks.find(t => t.id === session.taskId);
      if (task && task.status === 'pending') {
        allSessions.push({
          session: { ...session },
          originalDate: plan.date,
          task
        });
      }
    }
  }

  if (allSessions.length === 0) {
    return { plans: existingStudyPlans, suggestions: [] };
  }

  // Step 2: Calculate workload distribution and identify imbalances
  const workloadByDate: { [date: string]: number } = {};
  const availableDates = existingStudyPlans.map(p => p.date).sort();

  // Initialize workload tracking
  for (const date of availableDates) {
    workloadByDate[date] = 0;
  }

  // Calculate current workload including fixed sessions
  for (const plan of existingStudyPlans) {
    for (const session of plan.plannedTasks) {
      if (!session.done && session.status !== 'completed' && session.status !== 'skipped') {
        workloadByDate[plan.date] += session.allocatedHours;
      }
    }
  }

  // Step 3: Group sessions by task to maintain task organization
  const sessionsByTask: { [taskId: string]: Array<{ session: StudySession; originalDate: string; task: Task }> } = {};

  for (const sessionData of allSessions) {
    if (!sessionsByTask[sessionData.task.id]) {
      sessionsByTask[sessionData.task.id] = [];
    }
    sessionsByTask[sessionData.task.id].push(sessionData);
  }

  // Step 4: Create fresh study plans
  const reshuffledPlans: StudyPlan[] = availableDates.map(date => ({
    id: `plan-${date}`,
    date,
    plannedTasks: [],
    totalStudyHours: 0,
    availableHours: getDaySpecificDailyHours(date, settings)
  }));

  // Copy over completed/skipped sessions first
  for (const plan of existingStudyPlans) {
    const newPlan = reshuffledPlans.find(p => p.date === plan.date);
    if (newPlan) {
      for (const session of plan.plannedTasks) {
        if (session.done || session.status === 'completed' || session.status === 'skipped') {
          newPlan.plannedTasks.push({ ...session });
          newPlan.totalStudyHours += session.allocatedHours;
        }
      }
    }
  }

  // Step 5: Calculate ideal workload per day
  const totalHoursToDistribute = allSessions.reduce((sum, s) => sum + s.session.allocatedHours, 0);
  const idealHoursPerDay = totalHoursToDistribute / availableDates.length;

  // Step 6: Redistribute individual sessions across days for workload balance
  // Create a flat list of all sessions to redistribute individually
  const sessionsToRedistribute: Array<{
    session: StudySession;
    originalDate: string;
    task: Task;
  }> = [];

  for (const sessionData of allSessions) {
    sessionsToRedistribute.push(sessionData);
  }

  // Sort sessions by task priority first, then randomly to ensure fair distribution
  sessionsToRedistribute.sort((a, b) => {
    // Priority by importance and deadline urgency
    const aDaysUntilDeadline = a.task.deadline ?
      (new Date(a.task.deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) : 9999;
    const bDaysUntilDeadline = b.task.deadline ?
      (new Date(b.task.deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) : 9999;

    const aPriority = a.task.importance ?
      (aDaysUntilDeadline <= 3 ? 1 : 2) :
      (aDaysUntilDeadline <= 3 ? 3 : 4);
    const bPriority = b.task.importance ?
      (bDaysUntilDeadline <= 3 ? 1 : 2) :
      (bDaysUntilDeadline <= 3 ? 3 : 4);

    if (aPriority !== bPriority) return aPriority - bPriority;
    return aDaysUntilDeadline - bDaysUntilDeadline;
  });

  const suggestions: Array<{ taskTitle: string; unscheduledMinutes: number }> = [];

  // Step 7: Distribute each session individually to balance workload
  for (const sessionData of sessionsToRedistribute) {
    const task = sessionData.task;

    // Calculate valid days for this task (respecting deadline and start date)
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const startDate = task.startDate ? new Date(task.startDate) : today;
    const startDateStr = startDate > today ? task.startDate! : todayStr;

    let validDays = availableDates.filter(date => date >= startDateStr);

    if (task.deadline && task.deadlineType !== 'none') {
      const deadline = new Date(task.deadline);
      if (settings.bufferDays > 0) {
        deadline.setDate(deadline.getDate() - settings.bufferDays);
      }
      const deadlineStr = deadline.toISOString().split('T')[0];
      validDays = validDays.filter(date => date <= deadlineStr);
    }

    if (validDays.length === 0) {
      // No valid days for this task, add to suggestions
      suggestions.push({
        taskTitle: task.title,
        unscheduledMinutes: Math.round(sessionData.session.allocatedHours * 60)
      });
      continue;
    }

    // Find the day with the least current workload that's valid for this task
    const sortedValidDays = validDays.map(date => ({
      date,
      currentWorkload: reshuffledPlans.find(p => p.date === date)!.totalStudyHours,
      plan: reshuffledPlans.find(p => p.date === date)!
    })).sort((a, b) => a.currentWorkload - b.currentWorkload);

    let sessionPlaced = false;

    // Try to place the session on the day with least workload
    for (const targetDay of sortedValidDays) {
      // Find available time slot for this session
      const commitmentsForDay = fixedCommitments.filter(commitment =>
        doesCommitmentApplyToDate(commitment, targetDay.date)
      );

      const timeSlot = findNextAvailableTimeSlot(
        sessionData.session.allocatedHours,
        targetDay.plan.plannedTasks,
        commitmentsForDay,
        settings.studyWindowStartHour || 6,
        settings.studyWindowEndHour || 23,
        settings.bufferTimeBetweenSessions || 0,
        targetDay.date,
        settings
      );

      if (timeSlot) {
        // Successfully found a slot, add the session
        const newSession: StudySession = {
          ...sessionData.session,
          startTime: timeSlot.start,
          endTime: timeSlot.end,
          sessionNumber: targetDay.plan.plannedTasks.filter(s => s.taskId === task.id && s.status !== 'skipped' && !s.done && s.status !== 'completed').length + 1,
          isManualOverride: targetDay.date !== sessionData.originalDate ? true : sessionData.session.isManualOverride,
          originalTime: targetDay.date !== sessionData.originalDate ? sessionData.session.startTime : sessionData.session.originalTime,
          originalDate: targetDay.date !== sessionData.originalDate ? sessionData.originalDate : sessionData.session.originalDate
        };

        targetDay.plan.plannedTasks.push(newSession);
        targetDay.plan.totalStudyHours += sessionData.session.allocatedHours;
        sessionPlaced = true;
        break;
      }
    }

    if (!sessionPlaced) {
      // Couldn't find a slot anywhere, add to suggestions
      suggestions.push({
        taskTitle: task.title,
        unscheduledMinutes: Math.round(sessionData.session.allocatedHours * 60)
      });
    }
  }

  return { plans: reshuffledPlans, suggestions };
};

/**
 * Handle compromised sessions by detecting sessions that are overwhelmed
 * and redistributing their hours to other sessions of the same task
 * @param studyPlans Study plans to process
 * @param tasks All tasks for reference
 * @param settings User settings
 * @param dailyRemainingHours Available hours per day
 */
const handleCompromisedSessions = (
  studyPlans: StudyPlan[],
  tasks: Task[],
  settings: UserSettings,
  dailyRemainingHours: { [date: string]: number }
): void => {
  const maxSessionLength = settings.maxSessionHours || 4;
  const minSessionLength = (settings.minSessionLength || 15) / 60; // Convert to hours

  // Group all sessions by task
  const sessionsByTask: { [taskId: string]: { session: StudySession; planIndex: number; sessionIndex: number }[] } = {};

  studyPlans.forEach((plan, planIndex) => {
    plan.plannedTasks.forEach((session, sessionIndex) => {
      if (session.status !== 'skipped' && !session.done && session.status !== 'completed') {
        if (!sessionsByTask[session.taskId]) {
          sessionsByTask[session.taskId] = [];
        }
        sessionsByTask[session.taskId].push({ session, planIndex, sessionIndex });
      }
    });
  });

  // Process each task's sessions
  Object.entries(sessionsByTask).forEach(([taskId, sessionItems]) => {
    if (sessionItems.length <= 1) return; // Need at least 2 sessions to redistribute

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Identify compromised sessions (those that are too small or overwhelmed by other sessions)
    const compromisedSessions: typeof sessionItems = [];
    const healthySessions: typeof sessionItems = [];

    sessionItems.forEach(item => {
      const session = item.session;
      const planDate = studyPlans[item.planIndex].date;

      // Consider a session compromised if:
      // 1. It's below minimum session length
      // 2. The day is overwhelmed (total study hours > 80% of available hours)
      // 3. Session duration is significantly smaller than other sessions of the same task

      const dayPlan = studyPlans[item.planIndex];
      const dayCapacity = (dayPlan.availableHours ?? getDaySpecificDailyHours(planDate, settings));
      const dayUtilization = dayPlan.totalStudyHours / dayCapacity;

      const averageSessionLength = sessionItems.reduce((sum, si) => sum + si.session.allocatedHours, 0) / sessionItems.length;
      const isSignificantlySmaller = session.allocatedHours < (averageSessionLength * 0.5);

      const isCompromised =
        session.allocatedHours < minSessionLength ||
        dayUtilization > 0.8 ||
        isSignificantlySmaller;

      if (isCompromised) {
        compromisedSessions.push(item);
      } else {
        healthySessions.push(item);
      }
    });

    // If no healthy sessions to redistribute to, skip
    if (healthySessions.length === 0 || compromisedSessions.length === 0) {
      return;
    }

    console.log(`Task "${task.title}": Found ${compromisedSessions.length} compromised sessions, redistributing to ${healthySessions.length} healthy sessions`);

    // Redistribute hours from compromised sessions to healthy ones
    compromisedSessions.forEach(compromisedItem => {
      const compromisedSession = compromisedItem.session;
      const hoursToRedistribute = compromisedSession.allocatedHours;

      // Prepare other sessions for redistribution
      const otherSessions = healthySessions.map(item => item.session);

      // Calculate current available hours for each day with healthy sessions
      const tempDailyHours: { [date: string]: number } = {};
      healthySessions.forEach(item => {
        const planDate = studyPlans[item.planIndex].date;
        tempDailyHours[planDate] = dailyRemainingHours[planDate] || 0;
        // Add back the hours that would be freed up if we redistribute
        tempDailyHours[planDate] += compromisedSession.allocatedHours * (1 / healthySessions.length);
      });

      // Perform redistribution
      const { redistributedSessions, remainingHours } = redistributeCompromisedSession(
        compromisedSession,
        otherSessions,
        maxSessionLength,
        tempDailyHours
      );

      // Apply the redistribution results
      if (remainingHours < hoursToRedistribute * 0.1) { // Successfully redistributed at least 90%
        // Remove the compromised session
        const compromisedPlan = studyPlans[compromisedItem.planIndex];
        compromisedPlan.plannedTasks.splice(compromisedItem.sessionIndex, 1);
        compromisedPlan.totalStudyHours -= compromisedSession.allocatedHours;

        // Update daily remaining hours for the compromised session's day
        const compromisedPlanDate = compromisedPlan.date;
        dailyRemainingHours[compromisedPlanDate] += compromisedSession.allocatedHours;

        // Update the healthy sessions with redistributed hours
        redistributedSessions.forEach(redistributedSession => {
          // Find the corresponding healthy session and update it
          const healthyItem = healthySessions.find(item =>
            item.session.taskId === redistributedSession.taskId &&
            item.session.scheduledTime === redistributedSession.scheduledTime &&
            item.session.sessionNumber === redistributedSession.sessionNumber
          );

          if (healthyItem) {
            const originalHours = healthyItem.session.allocatedHours;
            const additionalHours = redistributedSession.allocatedHours - originalHours;

            if (additionalHours > 0) {
              // Update the session in the study plan
              studyPlans[healthyItem.planIndex].plannedTasks[healthyItem.sessionIndex] = redistributedSession;
              studyPlans[healthyItem.planIndex].totalStudyHours += additionalHours;

              // Update daily remaining hours
              const healthyPlanDate = studyPlans[healthyItem.planIndex].date;
              dailyRemainingHours[healthyPlanDate] -= additionalHours;
            }
          }
        });

        console.log(`Successfully redistributed ${(hoursToRedistribute - remainingHours).toFixed(2)}h from compromised session of task "${task.title}"`);
      } else {
        console.log(`Could not effectively redistribute compromised session of task "${task.title}": ${remainingHours.toFixed(2)}h remaining`);
      }
    });
  });
};

export const generateNewStudyPlan = (
  tasks: Task[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[],
  existingStudyPlans: StudyPlan[] = []
): { plans: StudyPlan[]; suggestions: Array<{ taskTitle: string; unscheduledMinutes: number }> } => {

  if (settings.studyPlanMode === 'even') {
    // EVEN DISTRIBUTION LOGIC
    // Separate deadline-based tasks from no-deadline tasks
    const allPendingTasks = tasks.filter(task => task.status === 'pending' && task.estimatedHours > 0);

    const deadlineTasks = allPendingTasks
      .filter(task => task.deadline && task.deadline.trim().length > 0 && task.deadlineType !== 'none')
      .sort((a, b) => {
        if (a.importance !== b.importance) return a.importance ? -1 : 1; // Important first
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime(); // Then by deadline (earlier = more urgent)
      });

    const noDeadlineTasks = allPendingTasks
      .filter(task => !task.deadline || task.deadline.trim().length === 0 || task.deadlineType === 'none')
      .sort((a, b) => {
        if (a.importance !== b.importance) return a.importance ? -1 : 1; // Important first
        return (a.title || '').localeCompare(b.title || ''); // Then alphabetically
      });

    // Use deadline tasks for now (we'll add no-deadline scheduling later)
    const tasksEven = deadlineTasks;


    // Step 1: Create a map of available study days
    const now = new Date();
    // Calculate latest deadline using original deadlines (buffer will be applied per task)
    const latestDeadline = new Date(Math.max(...tasksEven.map(t => new Date(t.deadline).getTime())));
    const availableDays: string[] = [];
    const tempDate = new Date(now);
    // Include the latest deadline day by using <= comparison
    while (tempDate <= latestDeadline) {
      const dateStr = tempDate.toISOString().split('T')[0];
      const dayOfWeek = tempDate.getDay();
      if (settings.workDays.includes(dayOfWeek)) {
        availableDays.push(dateStr);
      }
      tempDate.setDate(tempDate.getDate() + 1);
    }
    
    // When buffer days is 0, ensure we include the deadline day itself
    if (settings.bufferDays === 0) {
      // Add any missing deadline days that might not be included due to time zone issues
      tasksEven.forEach(task => {
        const deadlineDateStr = new Date(task.deadline).toISOString().split('T')[0];
        if (!availableDays.includes(deadlineDateStr) && settings.workDays.includes(new Date(deadlineDateStr).getDay())) {
          availableDays.push(deadlineDateStr);
        }
      });
      // Sort available days to maintain order
      availableDays.sort();
    } else {
      // When buffer days > 0, ensure we include the buffer-adjusted deadline days
      tasksEven.forEach(task => {
        const deadline = new Date(task.deadline);
        deadline.setDate(deadline.getDate() - settings.bufferDays);
        const deadlineDateStr = deadline.toISOString().split('T')[0];
        if (!availableDays.includes(deadlineDateStr) && settings.workDays.includes(new Date(deadlineDateStr).getDay())) {
          availableDays.push(deadlineDateStr);
        }
      });
      // Sort available days to maintain order
      availableDays.sort();
    }


    const studyPlans: StudyPlan[] = [];
    const dailyRemainingHours: { [date: string]: number } = {};
    availableDays.forEach(date => {
      // Calculate committed hours for this date that count toward daily hours
      const committedHours = calculateCommittedHoursForDate(date, fixedCommitments);
      const availableHoursAfterCommitments = Math.max(0, getDaySpecificDailyHours(date, settings) - committedHours);

      dailyRemainingHours[date] = availableHoursAfterCommitments;
      studyPlans.push({
        id: `plan-${date}`,
        date,
        plannedTasks: [],
        totalStudyHours: 0,
        availableHours: availableHoursAfterCommitments
      });
    });
    let evenTaskScheduledHours: { [taskId: string]: number } = {};
    tasksEven.forEach(task => {
      evenTaskScheduledHours[task.id] = 0;
    });

    // Helper function to redistribute unscheduled hours for a task
    const redistributeUnscheduledHours = (task: Task, unscheduledHours: number, daysForTask: string[]) => {
      let remainingUnscheduledHours = unscheduledHours;
      let redistributionRound = 0;
      const maxRedistributionRounds = 10; // Prevent infinite loops
      const minSessionLength = (settings.minSessionLength || 15) / 60; // in hours
      
      while (remainingUnscheduledHours > 0 && redistributionRound < maxRedistributionRounds) {
        redistributionRound++;
        
        // Find all available days within the task's deadline that have remaining capacity
        const availableDaysForRedistribution = daysForTask.filter(date => {
          return dailyRemainingHours[date] > 0;
        });
        
        if (availableDaysForRedistribution.length === 0) {
          // No more available days, can't redistribute further
          break;
        }
        
        // Try to create larger sessions by distributing to fewer days
        let distributedThisRound = 0;
        
        // Calculate optimal distribution for remaining hours
        const optimalSessions = optimizeSessionDistribution(task, remainingUnscheduledHours, availableDaysForRedistribution, settings);
        
        // Distribute optimal sessions to available days
        for (let i = 0; i < optimalSessions.length && i < availableDaysForRedistribution.length; i++) {
          const date = availableDaysForRedistribution[i];
          const dayPlan = studyPlans.find(p => p.date === date)!;
          const availableHours = dailyRemainingHours[date];
          const sessionLength = Math.min(optimalSessions[i], availableHours);
          
          if (sessionLength >= minSessionLength) {
            const roundedSessionLength = Math.round(sessionLength * 60) / 60;

            // Find available time slot for this session to prevent overlaps
            const commitmentsForDay = fixedCommitments.filter(commitment => {
              return doesCommitmentApplyToDate(commitment, date);
            });

            const timeSlot = findNextAvailableTimeSlot(
              roundedSessionLength,
              dayPlan.plannedTasks,
              commitmentsForDay,
              settings.studyWindowStartHour || 6,
              settings.studyWindowEndHour || 23,
              settings.bufferTimeBetweenSessions || 0,
              date
            );

            // Only add the session if we found a valid time slot
            if (timeSlot) {
              dayPlan.plannedTasks.push({
                taskId: task.id,
                scheduledTime: `${date}`,
                startTime: timeSlot.start,
                endTime: timeSlot.end,
                allocatedHours: roundedSessionLength,
                sessionNumber: (dayPlan.plannedTasks.filter(s => s.taskId === task.id).length) + 1,
                isFlexible: true,
                status: 'scheduled'
              });
              dayPlan.totalStudyHours = Math.round((dayPlan.totalStudyHours + roundedSessionLength) * 60) / 60;
              dailyRemainingHours[date] = Math.round((dailyRemainingHours[date] - roundedSessionLength) * 60) / 60;
              distributedThisRound = Math.round((distributedThisRound + roundedSessionLength) * 60) / 60;
            } else {
              // No available time slot found, skip this distribution
              console.log(`No available time slot found for ${roundedSessionLength} hours on ${date}`);
            }
          }
        }
        
        // Update remaining unscheduled hours
        remainingUnscheduledHours -= distributedThisRound;
        
        // If we couldn't distribute any hours this round, break to prevent infinite loop
        if (distributedThisRound === 0) {
          break;
        }
      }
      
      return remainingUnscheduledHours; // Return any still unscheduled hours
    };

    // Helper function to combine sessions of the same task on the same day
    const combineSessionsOnSameDay = (studyPlans: StudyPlan[]) => {
      for (const plan of studyPlans) {
        // Group sessions by taskId, excluding skipped sessions from combination
        const sessionsByTask: { [taskId: string]: StudySession[] } = {};
        
        plan.plannedTasks.forEach(session => {
          // Skip sessions that are marked as skipped - they shouldn't be combined with other sessions
          if (session.status === 'skipped') {
            return;
          }
          
          if (!sessionsByTask[session.taskId]) {
            sessionsByTask[session.taskId] = [];
          }
          sessionsByTask[session.taskId].push(session);
        });
        
        const combinedSessions: StudySession[] = [];
        
        // Combine sessions for each task - only if they are truly adjacent
        Object.entries(sessionsByTask).forEach(([taskId, sessions]) => {
          if (sessions.length > 1) {
            // Sort sessions by start time
          sessions.sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));

            // Group adjacent sessions together
            let currentGroup: StudySession[] = [sessions[0]];
            const sessionGroups: StudySession[][] = [];

            for (let i = 1; i < sessions.length; i++) {
              const currentSession = sessions[i];
              const lastInGroup = currentGroup[currentGroup.length - 1];

              // Check if sessions are adjacent (current starts when last ends)
              if (currentSession.startTime === lastInGroup.endTime) {
                currentGroup.push(currentSession);
              } else {
                // Not adjacent, start a new group
                sessionGroups.push(currentGroup);
                currentGroup = [currentSession];
              }
            }
            // Add the last group
            sessionGroups.push(currentGroup);

            // Combine each group of adjacent sessions
            sessionGroups.forEach((group, groupIndex) => {
              if (group.length > 1) {
                const firstSession = group[0];
                const lastSession = group[group.length - 1];
                const totalHours = group.reduce((sum, session) => sum + session.allocatedHours, 0);

                const combinedSession: StudySession = {
                  ...firstSession,
                  startTime: firstSession.startTime,
                  endTime: lastSession.endTime,
                  allocatedHours: totalHours,
                  sessionNumber: groupIndex + 1
                };

                combinedSessions.push(combinedSession);
              } else {
                // Single session in group, keep as is but update session number
                combinedSessions.push({
                  ...group[0],
                  sessionNumber: groupIndex + 1
                });
              }
            });
          } else {
            // Single session, keep as is
            combinedSessions.push(sessions[0]);
          }
        });
        
        // Update the plan with combined sessions (keeping skipped sessions separate)
        const skippedSessions = plan.plannedTasks.filter(session => session.status === 'skipped');
        plan.plannedTasks = [...combinedSessions, ...skippedSessions];

        // Calculate totalStudyHours based on all planned session durations
        plan.totalStudyHours = plan.plannedTasks.reduce((sum, s) => sum + s.allocatedHours, 0);
      }
    };



    // For each task, distribute hours evenly across available days until deadline
    for (const task of tasksEven) {
      const deadline = new Date(task.deadline);
      if (settings.bufferDays > 0) {
        deadline.setDate(deadline.getDate() - settings.bufferDays);
      }
      // Normalize deadline to start of day for comparison with date strings
      const deadlineDateStr = deadline.toISOString().split('T')[0];
      // Include all available days up to and including the deadline day
      const startDateStr = (task as any).startDate || now.toISOString().split('T')[0];
      let daysForTask = availableDays.filter(d => d >= startDateStr && d <= deadlineDateStr);
      

      
      // If no days available, skip this task
      if (daysForTask.length === 0) {
        continue;
      }
      
      let totalHours = task.estimatedHours;
      
      // Use optimized session distribution instead of simple even distribution
      const sessionLengths = optimizeSessionDistribution(task, totalHours, daysForTask, settings);
      

      // Assign sessions to available days, distributing optimally
      let unscheduledHours = 0;

      // Special handling for one-sitting tasks
      if (task.isOneTimeTask && sessionLengths.length === 1) {
        // For one-sitting tasks, try to find a day that can accommodate the full session
        let scheduledOneSitting = false;
        const fullSessionLength = sessionLengths[0];

        // First try the deadline day (or closest to deadline)
        for (let i = daysForTask.length - 1; i >= 0; i--) {
          const date = daysForTask[i];
          let availableHours = dailyRemainingHours[date];

          if (availableHours >= fullSessionLength) {
            // Found a day that can accommodate the full session
            let dayPlan = studyPlans.find(p => p.date === date)!;
            const roundedSessionLength = Math.round(fullSessionLength * 60) / 60;

            // Find available time slot for one-sitting task
            const commitmentsForDay = fixedCommitments.filter(commitment => {
              return doesCommitmentApplyToDate(commitment, date);
            });

            const timeSlot = findNextAvailableTimeSlot(
              roundedSessionLength,
              dayPlan.plannedTasks,
              commitmentsForDay,
              settings.studyWindowStartHour || 6,
              settings.studyWindowEndHour || 23,
              settings.bufferTimeBetweenSessions || 0,
              date,
              settings
            );

            if (timeSlot) {
              dayPlan.plannedTasks.push({
                taskId: task.id,
                scheduledTime: `${date}`,
                startTime: timeSlot.start,
                endTime: timeSlot.end,
                allocatedHours: roundedSessionLength,
                sessionNumber: 1,
                isFlexible: true,
                status: 'scheduled'
              });
              dayPlan.totalStudyHours = Math.round((dayPlan.totalStudyHours + roundedSessionLength) * 60) / 60;
              dailyRemainingHours[date] = Math.round((dailyRemainingHours[date] - roundedSessionLength) * 60) / 60;
              totalHours = Math.round((totalHours - roundedSessionLength) * 60) / 60;
              scheduledOneSitting = true;
              break;
            } else {
              console.log(`No available time slot found for one-sitting task "${task.title}\" (${roundedSessionLength}h) on ${date}`);
            }
          }
        }

        if (!scheduledOneSitting) {
          // Do NOT split one-sitting tasks. Leave unscheduled to avoid affecting other sessions.
          if (totalHours > 0) {
            unscheduledHours += totalHours;
          }
        }
      } else {
        // Regular task scheduling (can be split)
        for (let i = 0; i < sessionLengths.length && i < daysForTask.length; i++) {
          const date = daysForTask[i];
          let dayPlan = studyPlans.find(p => p.date === date)!;
          let availableHours = dailyRemainingHours[date];
          const thisSessionLength = Math.min(sessionLengths[i], availableHours);

          if (thisSessionLength > 0) {
            const roundedSessionLength = Math.round(thisSessionLength * 60) / 60;

            // Find available time slot for regular session
            const commitmentsForDay = fixedCommitments.filter(commitment => {
              return doesCommitmentApplyToDate(commitment, date);
            });

            const timeSlot = findNextAvailableTimeSlot(
              roundedSessionLength,
              dayPlan.plannedTasks,
              commitmentsForDay,
              settings.studyWindowStartHour || 6,
              settings.studyWindowEndHour || 23,
              settings.bufferTimeBetweenSessions || 0,
              date,
              settings
            );

            if (timeSlot) {
              dayPlan.plannedTasks.push({
                taskId: task.id,
                scheduledTime: `${date}`,
                startTime: timeSlot.start,
                endTime: timeSlot.end,
                allocatedHours: roundedSessionLength,
                sessionNumber: (dayPlan.plannedTasks.filter(s => s.taskId === task.id).length) + 1,
                isFlexible: true,
                status: 'scheduled'
              });
              dayPlan.totalStudyHours = Math.round((dayPlan.totalStudyHours + roundedSessionLength) * 60) / 60;
              dailyRemainingHours[date] = Math.round((dailyRemainingHours[date] - roundedSessionLength) * 60) / 60;
              totalHours = Math.round((totalHours - roundedSessionLength) * 60) / 60;
            } else {
              console.log(`No available time slot found for session of task "${task.title}" (${roundedSessionLength}h) on ${date}`);
              // Track unscheduled hours for redistribution
              unscheduledHours += roundedSessionLength;
            }
          } else {
            // Track unscheduled hours for redistribution
            unscheduledHours += sessionLengths[i];
          }
        }
      }
      
      // Redistribute any unscheduled hours using the improved redistribution logic
      if (unscheduledHours > 0) {
        console.log(`Task "${task.title}" has ${unscheduledHours} unscheduled hours to redistribute`);
        
        const finalUnscheduledHours = redistributeUnscheduledHours(task, unscheduledHours, daysForTask);
        
        if (finalUnscheduledHours > 0) {
          console.log(`Task "${task.title}" still has ${finalUnscheduledHours} unscheduled hours after redistribution`);
        }
      }
    }
    
    // Handle compromised sessions - detect and redistribute
    handleCompromisedSessions(studyPlans, tasksEven, settings, dailyRemainingHours);

    // Combine sessions of the same task on the same day
    combineSessionsOnSameDay(studyPlans);

    // Validate scheduling for conflicts after all redistribution and combining
    studyPlans.forEach(plan => {
      if (!validateSessionTimes(plan.plannedTasks, fixedCommitments, plan.date)) {
        console.warn(`Scheduling conflicts detected on ${plan.date} after redistribution. Some sessions may overlap.`);
      }
    });

    // Final pass: handle any remaining unscheduled hours and create suggestions
    const suggestions: Array<{ taskTitle: string; unscheduledMinutes: number }> = [];
    let taskScheduledHours: { [taskId: string]: number } = {};
    
    // Include newly generated sessions
  for (const plan of studyPlans) {
    for (const session of plan.plannedTasks) {
      taskScheduledHours[session.taskId] = (taskScheduledHours[session.taskId] || 0) + session.allocatedHours;
    }
  }
  // Also include FIXED sessions (done/completed/skipped) from existing plans so they are never counted as unscheduled
  if (existingStudyPlans && existingStudyPlans.length > 0) {
    for (const prevPlan of existingStudyPlans) {
      for (const prevSession of prevPlan.plannedTasks) {
        if (prevSession.done || prevSession.status === 'completed' || prevSession.status === 'skipped') {
          taskScheduledHours[prevSession.taskId] = (taskScheduledHours[prevSession.taskId] || 0) + prevSession.allocatedHours;
        }
      }
    }
  }
    
    // Global redistribution pass: try to fit any remaining unscheduled hours
    const tasksWithUnscheduledHours = tasksEven.filter(task => {
      const scheduledHours = taskScheduledHours[task.id] || 0;
      return task.estimatedHours - scheduledHours > 0;
    });
    
    if (tasksWithUnscheduledHours.length > 0) {
      console.log(`Global redistribution: ${tasksWithUnscheduledHours.length} tasks have unscheduled hours`);
      
      // Sort tasks by importance and deadline for global redistribution
      const sortedTasksForGlobalRedistribution = tasksWithUnscheduledHours.sort((a, b) => {
        if (a.importance !== b.importance) return a.importance ? -1 : 1;
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });
      
      for (const task of sortedTasksForGlobalRedistribution) {
        const scheduledHours = taskScheduledHours[task.id] || 0;
        const unscheduledHours = task.estimatedHours - scheduledHours;
        
        if (unscheduledHours <= 0) continue;
        
        // Get deadline for this task
        const deadline = new Date(task.deadline);
        if (settings.bufferDays > 0) {
          deadline.setDate(deadline.getDate() - settings.bufferDays);
        }
        const deadlineDateStr = deadline.toISOString().split('T')[0];
        const startDateStrA = (task as any).startDate || now.toISOString().split('T')[0];
        const daysForTask = availableDays.filter(d => d >= startDateStrA && d <= deadlineDateStr);
        
        // Try to redistribute remaining hours
        const finalUnscheduledHours = redistributeUnscheduledHours(task, unscheduledHours, daysForTask);
        
        if (finalUnscheduledHours > 0) {
          console.log(`Global redistribution: Task "${task.title}" still has ${finalUnscheduledHours} unscheduled hours`);
        }
      }
      
      // Recalculate scheduled hours after global redistribution, still including completed/skipped sessions
      taskScheduledHours = {};
      for (const plan of studyPlans) {
        for (const session of plan.plannedTasks) {
          taskScheduledHours[session.taskId] = (taskScheduledHours[session.taskId] || 0) + session.allocatedHours;
        }
      }
      
      // Combine sessions again after global redistribution
      combineSessionsOnSameDay(studyPlans);
    }
    
    // Check for unscheduled hours and create suggestions
    for (const task of tasksEven) {
      const scheduledHours = taskScheduledHours[task.id] || 0;
      const unscheduledHours = task.estimatedHours - scheduledHours;
      
      // Only show suggestions for tasks with more than 1 minute unscheduled (to avoid floating point precision issues)
      if (unscheduledHours > 0.016) { // 1 minute = 0.016 hours
        suggestions.push({
          taskTitle: task.title,
          unscheduledMinutes: Math.round(unscheduledHours * 60)
        });
      }
    }
    
    // For each day, sort plannedTasks by importance before assigning time slots
    for (const plan of studyPlans) {
              // Sort by importance first, then by deadline urgency (earlier deadline = more urgent)
        plan.plannedTasks.sort((a, b) => {
          const taskA = tasksEven.find(t => t.id === a.taskId);
          const taskB = tasksEven.find(t => t.id === b.taskId);
        if (!taskA || !taskB) return 0;
        if (taskA.importance !== taskB.importance) return taskA.importance ? -1 : 1;
        // If same importance, prioritize by deadline (earlier = more urgent)
        return new Date(taskA.deadline).getTime() - new Date(taskB.deadline).getTime();
      });
      // Assign time slots for each session, ensuring no overlap with commitments or other sessions
      // Use proper commitment filtering that handles both fixed and smart commitments
      const commitmentsForDay = fixedCommitments.filter(commitment => {
        return doesCommitmentApplyToDate(commitment, plan.date);
      });
      let assignedSessions: StudySession[] = [];
      for (const session of plan.plannedTasks) {
        const slot = findNextAvailableTimeSlot(
          session.allocatedHours,
          assignedSessions,
          commitmentsForDay,
          settings.studyWindowStartHour || 6,
          settings.studyWindowEndHour || 23,
          settings.bufferTimeBetweenSessions || 0,
          plan.date,
          settings
        );
        if (slot) {
          session.startTime = slot.start;
          session.endTime = slot.end;
          assignedSessions.push(session);
        } else {
          console.warn(`No available time slot found for session of task on ${plan.date} during final assignment - session will have no time`);
          session.startTime = '';
          session.endTime = '';
        }
      }

      // Validate that no sessions overlap on this day
      if (!validateSessionTimes(plan.plannedTasks, commitmentsForDay, plan.date)) {
        console.error(`Session overlap detected on ${plan.date} - some sessions may be incorrectly scheduled`);
      }
    }
    

    // Step 3: Schedule no-deadline tasks in remaining available time
    if (noDeadlineTasks.length > 0) {
      // Extend available days for no-deadline tasks (add 30 more days)
      const extendedDate = new Date(now);
      extendedDate.setDate(extendedDate.getDate() + 30);

      while (tempDate <= extendedDate) {
        const dateStr = tempDate.toISOString().split('T')[0];
        const dayOfWeek = tempDate.getDay();
        if (settings.workDays.includes(dayOfWeek) && !availableDays.includes(dateStr)) {
          availableDays.push(dateStr);
        }
        tempDate.setDate(tempDate.getDate() + 1);
      }

      // Create study plans for extended days if needed
      availableDays.forEach(date => {
        if (!studyPlans.find(plan => plan.date === date)) {
          studyPlans.push({
            id: `${date}-study-plan`,
            date,
            plannedTasks: [],
            totalStudyHours: 0,
            availableHours: getDaySpecificDailyHours(date, settings)
          });
        }
      });

      // Schedule no-deadline tasks in available slots
      noDeadlineTasks.forEach((task, taskIndex) => {
        let remainingHours = task.estimatedHours;
        const minSessionHours = (task.minWorkBlock || 30) / 60; // Convert minutes to hours

        // Determine session frequency based on task preferences and available time
        let sessionGap = 1; // Days between sessions
        const availableDaysForTask = availableDays.length;
        const estimatedSessionsNeeded = Math.ceil(task.estimatedHours / 2); // Assume 2 hours per session average

        if (task.targetFrequency === 'weekly') {
          sessionGap = Math.min(7, Math.floor(availableDaysForTask / Math.max(1, estimatedSessionsNeeded)));
        } else if (task.targetFrequency === '3x-week') {
          sessionGap = Math.min(2, Math.floor(availableDaysForTask / Math.max(1, estimatedSessionsNeeded)));
        } else if (task.targetFrequency === 'flexible') {
          // For flexible tasks, adapt the gap based on available time and task urgency
          const optimalGap = Math.floor(availableDaysForTask / Math.max(1, estimatedSessionsNeeded));
          sessionGap = task.importance ? Math.max(1, Math.min(2, optimalGap)) : Math.max(1, Math.min(3, optimalGap));
        }

        let sessionNumber = 1;
        let dayIndex = 0;
        let failedAttempts = 0; // Track failed scheduling attempts

        // Respect task start date for no-deadline tasks
        const startStr = (task as any).startDate || now.toISOString().split('T')[0];
        // Initialize dayIndex to first day >= startStr
        while (dayIndex < availableDays.length && availableDays[dayIndex] < startStr) {
          dayIndex++;
        }
        while (remainingHours > 0 && dayIndex < availableDays.length) {
          const currentDate = availableDays[dayIndex];
          const plan = studyPlans.find(p => p.date === currentDate);

          if (plan) {
            // Calculate available time on this day (excluding completed sessions)
            const usedHours = plan.plannedTasks.reduce((sum, session) => {
              // Don't count completed sessions toward used hours
              if (session.done || session.status === 'completed') return sum;
              return sum + session.allocatedHours;
            }, 0);
            const availableHours = plan.availableHours - usedHours;

            // Check if we have enough time for minimum session
            if (availableHours >= minSessionHours) {
              // Determine session length based on task frequency preference and max session length
          let maxSessionHours = task.maxSessionLength || 2; // Use task's preference or default
          if (task.targetFrequency === 'weekly') {
            maxSessionHours = Math.min(maxSessionHours * 2, remainingHours); // Longer sessions for weekly tasks
          } else if (task.targetFrequency === 'daily') {
            maxSessionHours = Math.min(maxSessionHours * 0.75, remainingHours); // Shorter sessions for daily tasks
          }

          const sessionHours = Math.min(
            remainingHours,
            availableHours,
            Math.max(minSessionHours, maxSessionHours)
          );

              // Find proper time slot using the existing function to avoid conflicts
              const commitmentsForDay = fixedCommitments.filter(commitment => {
                return doesCommitmentApplyToDate(commitment, currentDate);
              });

              const slot = findNextAvailableTimeSlot(
                sessionHours,
                plan.plannedTasks, // existing sessions on this day
                commitmentsForDay,
                settings.studyWindowStartHour || 6,
                settings.studyWindowEndHour || 23,
                settings.bufferTimeBetweenSessions || 0,
                currentDate
              );

              if (slot) {
                const session: StudySession = {
                  taskId: task.id,
                  scheduledTime: currentDate,
                  startTime: slot.start,
                  endTime: slot.end,
                  allocatedHours: sessionHours,
                  sessionNumber,
                  isFlexible: true // Mark as flexible for easy rescheduling
                };

                plan.plannedTasks.push(session);
                plan.totalStudyHours += sessionHours;
                remainingHours -= sessionHours;
                sessionNumber++;
                failedAttempts = 0; // Reset failed attempts on successful scheduling
              } else {
                // No available slot on this day
                failedAttempts++;
                // For flexible tasks, try more frequently if we're having trouble scheduling
                if (task.targetFrequency === 'flexible' && failedAttempts > 2) {
                  sessionGap = 1; // Fall back to daily attempts
                }
              }

              // Apply session gap for next scheduling
              dayIndex += sessionGap;
            } else {
              dayIndex++;
            }
          } else {
            dayIndex++;
          }
        }

        // Track unscheduled hours
        if (remainingHours > 0) {
          suggestions.push({
            taskTitle: task.title,
            unscheduledMinutes: Math.round(remainingHours * 60)
          });
        }
      });
    }

    // After all days, return plans and suggestions for any unscheduled hours
    return { plans: studyPlans, suggestions };
  }

  if (settings.studyPlanMode === 'balanced') {
    // BALANCED PRIORITY DISTRIBUTION LOGIC
    // Combines even distribution stability with priority-based task ordering
    const allPendingTasksBalanced = tasks.filter(task => task.status === 'pending' && task.estimatedHours > 0);

    const deadlineTasksBalanced = allPendingTasksBalanced
      .filter(task => task.deadline && task.deadline.trim().length > 0 && task.deadlineType !== 'none')
      .sort((a, b) => {
        // First sort by importance
        if (a.importance !== b.importance) return a.importance ? -1 : 1;
        // Then by deadline urgency for same importance level
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      });

    const noDeadlineTasksBalanced = allPendingTasksBalanced
      .filter(task => !task.deadline || task.deadline.trim().length === 0 || task.deadlineType === 'none')
      .sort((a, b) => {
        if (a.importance !== b.importance) return a.importance ? -1 : 1; // Important first
        return (a.title || '').localeCompare(b.title || ''); // Then alphabetically
      });

    const tasksBalanced = deadlineTasksBalanced;

    // Create priority tiers for balanced distribution
    const importantTasks = tasksBalanced.filter(task => task.importance);
    const regularTasks = tasksBalanced.filter(task => !task.importance);

    // Further categorize by deadline urgency within each tier
    const now = new Date();
    const urgentImportant = importantTasks.filter(task => {
      const daysUntilDeadline = (new Date(task.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return daysUntilDeadline <= 3;
    });
    const notUrgentImportant = importantTasks.filter(task => {
      const daysUntilDeadline = (new Date(task.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return daysUntilDeadline > 3;
    });
    const urgentRegular = regularTasks.filter(task => {
      const daysUntilDeadline = (new Date(task.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return daysUntilDeadline <= 3;
    });
    const notUrgentRegular = regularTasks.filter(task => {
      const daysUntilDeadline = (new Date(task.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return daysUntilDeadline > 3;
    });

    // Reorder tasks by balanced priority: Q1 (urgent+important) -> Q2 (important) -> Q3 (urgent) -> Q4 (neither)
    const prioritizedTasks = [...urgentImportant, ...notUrgentImportant, ...urgentRegular, ...notUrgentRegular];

    // Use same day calculation logic as even mode
    const latestDeadline = new Date(Math.max(...prioritizedTasks.map(t => new Date(t.deadline).getTime())));
    const availableDays: string[] = [];
    const tempDate = new Date(now);
    while (tempDate <= latestDeadline) {
      const dateStr = tempDate.toISOString().split('T')[0];
      const dayOfWeek = tempDate.getDay();
      if (settings.workDays.includes(dayOfWeek)) {
        availableDays.push(dateStr);
      }
      tempDate.setDate(tempDate.getDate() + 1);
    }

    // Include deadline days
    if (settings.bufferDays === 0) {
      prioritizedTasks.forEach(task => {
        const deadlineDateStr = new Date(task.deadline).toISOString().split('T')[0];
        if (!availableDays.includes(deadlineDateStr) && settings.workDays.includes(new Date(deadlineDateStr).getDay())) {
          availableDays.push(deadlineDateStr);
        }
      });
    } else {
      prioritizedTasks.forEach(task => {
        const deadline = new Date(task.deadline);
        deadline.setDate(deadline.getDate() - settings.bufferDays);
        const deadlineDateStr = deadline.toISOString().split('T')[0];
        if (!availableDays.includes(deadlineDateStr) && settings.workDays.includes(new Date(deadlineDateStr).getDay())) {
          availableDays.push(deadlineDateStr);
        }
      });
    }
    availableDays.sort();

    const studyPlans: StudyPlan[] = [];
    const dailyRemainingHours: { [date: string]: number } = {};
    availableDays.forEach(date => {
      // Calculate committed hours for this date that count toward daily hours
      const committedHours = calculateCommittedHoursForDate(date, fixedCommitments);
      const availableHoursAfterCommitments = Math.max(0, getDaySpecificDailyHours(date, settings) - committedHours);

      dailyRemainingHours[date] = availableHoursAfterCommitments;
      studyPlans.push({
        id: `plan-${date}`,
        date,
        plannedTasks: [],
        totalStudyHours: 0,
        availableHours: availableHoursAfterCommitments
      });
    });

    // Balanced distribution: Apply even distribution within priority tiers
    const distributeTierTasks = (tierTasks: Task[], tierName: string) => {
      const tierTaskScheduledHours: { [taskId: string]: number } = {};
      tierTasks.forEach(task => {
        tierTaskScheduledHours[task.id] = 0;
      });

      // Calculate total hours needed for this tier
      const totalTierHours = tierTasks.reduce((sum, task) => sum + task.estimatedHours, 0);

      if (totalTierHours === 0) return;

      // Distribute tier tasks evenly across available days until their deadlines
      for (const task of tierTasks) {
        const deadline = new Date(task.deadline);
        if (settings.bufferDays > 0) {
          deadline.setDate(deadline.getDate() - settings.bufferDays);
        }
        const deadlineDateStr = deadline.toISOString().split('T')[0];
        const startDateStrB = (task as any).startDate || now.toISOString().split('T')[0];
        const daysForTask = availableDays.filter(d => d >= startDateStrB && d <= deadlineDateStr);

        if (daysForTask.length === 0) continue;

        // Use optimized session distribution for even spreading
        const sessionLengths = optimizeSessionDistribution(task, task.estimatedHours, daysForTask, settings);

        for (let i = 0; i < sessionLengths.length && i < daysForTask.length; i++) {
          let dayIndex = i;
          
          // For non-important one-sitting tasks, prefer scheduling on the actual deadline day (respecting buffer)
          if (task.isOneTimeTask && !task.importance && sessionLengths.length === 1) {
            // Calculate the effective deadline (respecting buffer days)
            const effectiveDeadline = new Date(task.deadline);
            if (settings.bufferDays > 0) {
              effectiveDeadline.setDate(effectiveDeadline.getDate() - settings.bufferDays);
            }
            const effectiveDeadlineStr = effectiveDeadline.toISOString().split('T')[0];
            
            // First priority: Schedule on the effective deadline day itself (last available day)
            const effectiveDeadlineIndex = daysForTask.indexOf(effectiveDeadlineStr);
            
            if (effectiveDeadlineIndex !== -1) {
              // Effective deadline day is available, use it
              dayIndex = effectiveDeadlineIndex;
            } else {
              // Fallback: Find the closest available day to the effective deadline
              const effectiveDeadlineTime = effectiveDeadline.getTime();
              let closestIndex = daysForTask.length - 1; // Start with the last available day
              let minDistance = Math.abs(new Date(daysForTask[closestIndex]).getTime() - effectiveDeadlineTime);
              
              for (let j = 0; j < daysForTask.length - 1; j++) {
                const distance = Math.abs(new Date(daysForTask[j]).getTime() - effectiveDeadlineTime);
                if (distance < minDistance) {
                  minDistance = distance;
                  closestIndex = j;
                }
              }
              dayIndex = closestIndex;
            }
          }
          
          const date = daysForTask[dayIndex];
          const dayPlan = studyPlans.find(p => p.date === date)!;
          const availableHours = dailyRemainingHours[date];
          const thisSessionLength = Math.min(sessionLengths[i], availableHours);

          if (thisSessionLength > 0) {
            const roundedSessionLength = Math.round(thisSessionLength * 60) / 60;
            dayPlan.plannedTasks.push({
              taskId: task.id,
              scheduledTime: `${date}`,
              startTime: '',
              endTime: '',
              allocatedHours: roundedSessionLength,
              sessionNumber: (dayPlan.plannedTasks.filter(s => s.taskId === task.id).length) + 1,
              isFlexible: true,
              status: 'scheduled'
            });
            dayPlan.totalStudyHours = Math.round((dayPlan.totalStudyHours + roundedSessionLength) * 60) / 60;
            dailyRemainingHours[date] = Math.round((dailyRemainingHours[date] - roundedSessionLength) * 60) / 60;
            tierTaskScheduledHours[task.id] = Math.round((tierTaskScheduledHours[task.id] + roundedSessionLength) * 60) / 60;
          }
        }
      }
    };

    // Distribute tasks by priority tier
    distributeTierTasks(urgentImportant, 'Urgent & Important');
    distributeTierTasks(notUrgentImportant, 'Important');
    distributeTierTasks(urgentRegular, 'Urgent');
    distributeTierTasks(notUrgentRegular, 'Regular');

    // Sort sessions within each day by priority (important first, then by deadline)
    for (const plan of studyPlans) {
      plan.plannedTasks.sort((a, b) => {
        const taskA = prioritizedTasks.find(t => t.id === a.taskId);
        const taskB = prioritizedTasks.find(t => t.id === b.taskId);
        if (!taskA || !taskB) return 0;
        if (taskA.importance !== taskB.importance) return taskA.importance ? -1 : 1;
        return new Date(taskA.deadline).getTime() - new Date(taskB.deadline).getTime();
      });

      // Assign time slots with same logic as other modes
      const commitmentsForDay = fixedCommitments.filter(commitment => {
        return doesCommitmentApplyToDate(commitment, plan.date);
      });

      let assignedSessions: StudySession[] = [];
      for (const session of plan.plannedTasks) {
        const slot = findNextAvailableTimeSlot(
          session.allocatedHours,
          assignedSessions,
          commitmentsForDay,
          settings.studyWindowStartHour || 6,
          settings.studyWindowEndHour || 23,
          settings.bufferTimeBetweenSessions || 0,
          plan.date
        );
        if (slot) {
          session.startTime = slot.start;
          session.endTime = slot.end;
          assignedSessions.push(session);
        } else {
          session.startTime = '';
          session.endTime = '';
        }
      }
    }

    // Schedule no-deadline tasks in remaining available time with frequency consideration
    if (noDeadlineTasksBalanced.length > 0) {
      noDeadlineTasksBalanced.forEach(task => {
        let remainingHours = task.estimatedHours;
        const minSessionHours = (task.minWorkBlock || 30) / 60;
        let sessionNumber = 1;

        // Determine session frequency based on task preferences
        let sessionGap = 1;
        if (task.targetFrequency === 'weekly') sessionGap = 7;
        else if (task.targetFrequency === '3x-week') sessionGap = 2;
        else if (task.targetFrequency === 'flexible') {
          sessionGap = task.importance ? 2 : 3;
        }

        let planIndex = 0;
        while (remainingHours > 0 && planIndex < studyPlans.length) {
          const plan = studyPlans[planIndex];
          const usedHours = plan.plannedTasks.reduce((sum, session) => {
            // Don't count completed sessions toward used hours
            if (session.done || session.status === 'completed') return sum;
            return sum + session.allocatedHours;
          }, 0);
          const availableHours = plan.availableHours - usedHours;

          if (availableHours >= minSessionHours) {
            // Determine session length based on frequency preference and task preference
            let maxSessionHours = task.maxSessionLength || 1.5; // Use task's preference or default
            if (task.targetFrequency === 'weekly') {
              maxSessionHours = Math.min(maxSessionHours * 2, remainingHours); // Longer sessions for weekly tasks
            } else if (task.targetFrequency === 'daily') {
              maxSessionHours = Math.min(maxSessionHours * 0.75, remainingHours); // Shorter sessions for daily tasks
            }

            let sessionHours;
            if (task.isOneTimeTask && sessionNumber === 1) {
              sessionHours = remainingHours <= availableHours ? remainingHours : 0;
            } else {
              sessionHours = Math.min(remainingHours, availableHours, maxSessionHours);
            }

            if (sessionHours > 0) {
              // Find available time slot
              const commitmentsForDay = fixedCommitments.filter(commitment =>
                doesCommitmentApplyToDate(commitment, plan.date)
              );

              const slot = findNextAvailableTimeSlot(
                sessionHours,
                plan.plannedTasks,
                commitmentsForDay,
                settings.studyWindowStartHour || 6,
                settings.studyWindowEndHour || 23,
                settings.bufferTimeBetweenSessions || 0,
                plan.date
              );

              if (slot) {
                const session: StudySession = {
                  taskId: task.id,
                  scheduledTime: plan.date,
                  startTime: slot.start,
                  endTime: slot.end,
                  allocatedHours: sessionHours,
                  sessionNumber,
                  isFlexible: true
                };

                plan.plannedTasks.push(session);
                plan.totalStudyHours += sessionHours;
                remainingHours -= sessionHours;
                sessionNumber++;
              }
            }
          }

          planIndex += sessionGap; // Apply frequency gap
        }
      });
    }

    // Create suggestions for any unscheduled hours
    const suggestions = getUnscheduledMinutesForTasks(prioritizedTasks,
      prioritizedTasks.reduce((acc, task) => {
        acc[task.id] = studyPlans.reduce((sum, plan) =>
          sum + plan.plannedTasks.filter(s => s.taskId === task.id && s.status !== 'skipped')
            .reduce((sessionSum, session) => sessionSum + session.allocatedHours, 0), 0);
        return acc;
      }, {} as { [taskId: string]: number }), settings);

    return { plans: studyPlans, suggestions };
  }

  // Step 1: Filter and sort tasks by Eisenhower Matrix logic
  const allPendingTasksEisen = tasks.filter(task => task.status === 'pending' && task.estimatedHours > 0);

  const deadlineTasksEisen = allPendingTasksEisen
    .filter(task => task.deadline && task.deadline.trim().length > 0 && task.deadlineType !== 'none')
    .sort((a, b) => {
      if (a.importance !== b.importance) return a.importance ? -1 : 1; // Important first
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime(); // Then by deadline
    });

  const noDeadlineTasksEisen = allPendingTasksEisen
    .filter(task => !task.deadline || task.deadline.trim().length === 0 || task.deadlineType === 'none')
    .sort((a, b) => {
      if (a.importance !== b.importance) return a.importance ? -1 : 1; // Important first
      return (a.title || '').localeCompare(b.title || ''); // Then alphabetically
    });

  const tasksSorted = deadlineTasksEisen;

  // Step 2: Create a map of available study days (using same logic as even mode)
  const now = new Date();
  // Calculate latest deadline using original deadlines (buffer will be applied per task)
  const latestDeadline = new Date(Math.max(...tasksSorted.map(t => new Date(t.deadline).getTime())));
  const availableDays: string[] = [];
  const tempDate = new Date(now);
  // Include the latest deadline day by using <= comparison
  while (tempDate <= latestDeadline) {
    const dateStr = tempDate.toISOString().split('T')[0];
    const dayOfWeek = tempDate.getDay();
    if (settings.workDays.includes(dayOfWeek)) {
      availableDays.push(dateStr);
    }
    tempDate.setDate(tempDate.getDate() + 1);
  }
  
  // When buffer days is 0, ensure we include the deadline day itself
  if (settings.bufferDays === 0) {
    // Add any missing deadline days that might not be included due to time zone issues
    tasksSorted.forEach(task => {
      const deadlineDateStr = new Date(task.deadline).toISOString().split('T')[0];
      if (!availableDays.includes(deadlineDateStr) && settings.workDays.includes(new Date(deadlineDateStr).getDay())) {
        availableDays.push(deadlineDateStr);
      }
    });
    // Sort available days to maintain order
    availableDays.sort();
  } else {
    // When buffer days > 0, ensure we include the buffer-adjusted deadline days
    tasksSorted.forEach(task => {
      const deadline = new Date(task.deadline);
      deadline.setDate(deadline.getDate() - settings.bufferDays);
      const deadlineDateStr = deadline.toISOString().split('T')[0];
      if (!availableDays.includes(deadlineDateStr) && settings.workDays.includes(new Date(deadlineDateStr).getDay())) {
        availableDays.push(deadlineDateStr);
      }
    });
    // Sort available days to maintain order
  availableDays.sort();
  }

  const studyPlans: StudyPlan[] = [];
  const dailyRemainingHours: { [date: string]: number } = {};
  availableDays.forEach(date => {
    // Calculate committed hours for this date that count toward daily hours
    const committedHours = calculateCommittedHoursForDate(date, fixedCommitments);
    const availableHoursAfterCommitments = Math.max(0, getDaySpecificDailyHours(date, settings) - committedHours);

    dailyRemainingHours[date] = availableHoursAfterCommitments;
    studyPlans.push({
      id: `plan-${date}`,
      date,
      plannedTasks: [],
      totalStudyHours: 0,
      availableHours: availableHoursAfterCommitments
    });
  });

  let taskScheduledHours: { [taskId: string]: number } = {};
  tasksSorted.forEach(task => {
    taskScheduledHours[task.id] = 0;
  });

  // suggestions will be created by the helper below

  // For each day, allocate hours by Eisenhower Matrix order
  for (const date of availableDays) {
    let dayPlan = studyPlans.find(p => p.date === date)!;
    let availableHours = dailyRemainingHours[date];
    // Get all fixed commitments for this day
            const commitmentsForDay = fixedCommitments.filter(commitment => {
          return doesCommitmentApplyToDate(commitment, date);
        });
    // Get tasks that still need hours and are not past their deadline (using same logic as even mode)
    const tasksForDay = tasksSorted.filter(task => {
      const deadline = new Date(task.deadline);
      if (settings.bufferDays > 0) {
        deadline.setDate(deadline.getDate() - settings.bufferDays);
      }
      // Normalize deadline to start of day for comparison
      const deadlineDateStr = deadline.toISOString().split('T')[0];
      const startDateStrC = (task as any).startDate || now.toISOString().split('T')[0];
      const daysForTask = availableDays.filter(d => d >= startDateStrC && d <= deadlineDateStr);
      return taskScheduledHours[task.id] < task.estimatedHours && date <= deadlineDateStr;
    });
    for (const task of tasksForDay) {
      if (availableHours <= 0) break;
      const remainingTaskHours = task.estimatedHours - taskScheduledHours[task.id];
      if (remainingTaskHours <= 0) continue;
      // Allocate as much as possible for this task
      // For one-time tasks, schedule all remaining hours at once if possible
      let hoursToSchedule;
      if (task.isOneTimeTask && taskScheduledHours[task.id] === 0) {
        // One-time task: try to schedule all hours at once, but if not possible on this day,
        // skip to try other days instead of failing completely
        if (remainingTaskHours <= availableHours) {
          hoursToSchedule = remainingTaskHours;
        } else {
          // Continue to next day to find one that can accommodate the full session
          continue;
        }
      } else {
        // Regular task: can be split across sessions
        hoursToSchedule = Math.min(remainingTaskHours, availableHours);
      }
      if (hoursToSchedule > 0) {
        // Find the next available time slot for this session
        const existingSessions = dayPlan.plannedTasks;
        const slot = findNextAvailableTimeSlot(
          hoursToSchedule,
          existingSessions,
          commitmentsForDay,
          settings.studyWindowStartHour || 6,
          settings.studyWindowEndHour || 23,
          settings.bufferTimeBetweenSessions || 0, // pass buffer
          date // pass target date for filtering deleted occurrences
        );
        if (!slot) continue; // No available slot for this session
        const sessionNumber = (dayPlan.plannedTasks.filter(s => s.taskId === task.id).length) + 1;
        const session: StudySession = {
          taskId: task.id,
          scheduledTime: `${date} ${slot.start}`,
          startTime: slot.start,
          endTime: slot.end,
          allocatedHours: Math.round(hoursToSchedule * 60) / 60,
          sessionNumber,
          isFlexible: true,
          status: 'scheduled'
        };
        dayPlan.plannedTasks.push(session);
        dayPlan.totalStudyHours = Math.round((dayPlan.totalStudyHours + session.allocatedHours) * 60) / 60;
        dailyRemainingHours[date] = Math.round((dailyRemainingHours[date] - session.allocatedHours) * 60) / 60;
        availableHours = Math.round((availableHours - session.allocatedHours) * 60) / 60;
        taskScheduledHours[task.id] = Math.round((taskScheduledHours[task.id] + session.allocatedHours) * 60) / 60;
      }
    }
  }

  // Schedule no-deadline tasks in remaining available time
  if (noDeadlineTasksEisen.length > 0) {
    noDeadlineTasksEisen.forEach(task => {
      let remainingHours = task.estimatedHours;
      const minSessionHours = (task.minWorkBlock || 30) / 60;
      let sessionNumber = 1;

      for (const plan of studyPlans) {
        if (remainingHours <= 0) break;

        const usedHours = plan.plannedTasks.reduce((sum, session) => {
          // Don't count completed sessions toward used hours
          if (session.done || session.status === 'completed') return sum;
          return sum + session.allocatedHours;
        }, 0);
        const availableHours = plan.availableHours - usedHours;

        if (availableHours >= minSessionHours) {
          // Determine session length based on task preference and frequency
          let maxSessionHours = task.maxSessionLength || 1.5; // Use task's preference or default
          if (task.targetFrequency === 'weekly') {
            maxSessionHours = Math.min(maxSessionHours * 2, remainingHours); // Longer sessions for weekly tasks
          } else if (task.targetFrequency === 'daily') {
            maxSessionHours = Math.min(maxSessionHours * 0.75, remainingHours); // Shorter sessions for daily tasks
          }

          let sessionHours;
          if (task.isOneTimeTask && sessionNumber === 1) {
            sessionHours = remainingHours <= availableHours ? remainingHours : 0;
          } else {
            sessionHours = Math.min(remainingHours, availableHours, maxSessionHours);
          }

          if (sessionHours <= 0) continue;

          // Find available time slot
          const commitmentsForDay = fixedCommitments.filter(commitment =>
            doesCommitmentApplyToDate(commitment, plan.date)
          );

          const slot = findNextAvailableTimeSlot(
            sessionHours,
            plan.plannedTasks,
            commitmentsForDay,
            settings.studyWindowStartHour || 6,
            settings.studyWindowEndHour || 23,
            settings.bufferTimeBetweenSessions || 0,
            plan.date
          );

          if (slot) {
            const session: StudySession = {
              taskId: task.id,
              scheduledTime: `${plan.date} ${slot.start}`,
              startTime: slot.start,
              endTime: slot.end,
              allocatedHours: sessionHours,
              sessionNumber,
              isFlexible: true,
              status: 'scheduled'
            };

            plan.plannedTasks.push(session);
            plan.totalStudyHours += sessionHours;
            remainingHours -= sessionHours;
            sessionNumber++;
          }
        }
      }

      // Add to task scheduled hours tracking
      taskScheduledHours[task.id] = (taskScheduledHours[task.id] || 0) + (task.estimatedHours - remainingHours);
    });
  }

  // Include fixed (completed/skipped/done) sessions from existing plans so they are not counted as unscheduled
  if (existingStudyPlans && existingStudyPlans.length > 0) {
    for (const prevPlan of existingStudyPlans) {
      for (const prevSession of prevPlan.plannedTasks) {
        if (prevSession.done || prevSession.status === 'completed' || prevSession.status === 'skipped') {
          taskScheduledHours[prevSession.taskId] = (taskScheduledHours[prevSession.taskId] || 0) + prevSession.allocatedHours;
        }
      }
    }
  }

  // After all days, add suggestions for any unscheduled hours
  const suggestions = getUnscheduledMinutesForTasks(tasksSorted, taskScheduledHours, settings);
  return { plans: studyPlans, suggestions };
};

// Legacy functions for backward compatibility
export const generateStudyPlan = generateNewStudyPlan;

export const generateSmartSuggestions = (tasks: Task[], unscheduledTasks?: Task[]) => {
  const suggestions = [];
  const now = new Date();

  // Overdue tasks (any quadrant)
  const overdueTasks = tasks.filter(task => {
    const deadline = new Date(task.deadline);
    return deadline < now && task.status === 'pending';
  });
  if (overdueTasks.length > 0) {
    suggestions.push({
      type: 'warning' as const,
      message: `You have ${overdueTasks.length} overdue task(s). Consider extending deadlines or increasing study hours.`,
      action: 'Review and update deadlines for overdue tasks.'
    });
  }

  // Q1 & Q3: Urgent tasks (due soon)
  const urgentTasks = tasks.filter(task => {
    const deadline = new Date(task.deadline);
    const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilDeadline <= 3 && task.status === 'pending';
  });
  const urgentImportant = urgentTasks.filter(task => task.importance);
  const urgentNotImportant = urgentTasks.filter(task => !task.importance);

  if (urgentImportant.length > 0) {
    suggestions.push({
      type: 'warning' as const,
      message: `You have ${urgentImportant.length} important task(s) due within 3 days.`,
      action: 'Focus on these tasks first to avoid last-minute stress.'
    });
  }
  if (urgentNotImportant.length > 0) {
    suggestions.push({
      type: 'warning' as const,
      message: `You have ${urgentNotImportant.length} urgent but not important task(s) due soon. These may not fit in your schedule.`,
      action: 'Consider increasing your daily hour limit, delegating, or rescheduling these tasks.'
    });
  }

  // Eisenhower mode: Warn if urgent low-priority tasks are unscheduled due to prioritization
  if (unscheduledTasks && unscheduledTasks.length > 0) {
    const unscheduledUrgentLowPriority = unscheduledTasks.filter(task => {
      const deadline = new Date(task.deadline);
      const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilDeadline <= 3 && !task.importance && task.status === 'pending';
    });
    if (unscheduledUrgentLowPriority.length > 0) {
      suggestions.push({
        type: 'warning' as const,
        message: `Some low-priority tasks with urgent deadlines could not be scheduled because higher-priority urgent tasks are taking precedence.`,
        action: 'Consider increasing your daily available hours, rescheduling, or marking some tasks as more important.'
      });
    }
  }

  // Q2: Important but not urgent (encourage scheduling)
  const importantNotUrgent = tasks.filter(task => {
    const deadline = new Date(task.deadline);
    const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilDeadline > 3 && task.importance && task.status === 'pending';
  });
  if (importantNotUrgent.length > 0) {
    suggestions.push({
      type: 'suggestion' as const,
      message: `You have ${importantNotUrgent.length} important task(s) with more than 3 days until deadline.`,
      action: 'Schedule time for these now to avoid last-minute stress.'
    });
  }

  // Q4: Not important & not urgent (may be unscheduled)
  const notImportantNotUrgent = tasks.filter(task => {
    const deadline = new Date(task.deadline);
    const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilDeadline > 3 && !task.importance && task.status === 'pending';
  });
  if (notImportantNotUrgent.length > 0) {
    suggestions.push({
      type: 'suggestion' as const,
      message: `You have ${notImportantNotUrgent.length} task(s) that are neither urgent nor important.`,
      action: 'Do these only if you have extra time, or consider dropping them.'
    });
  }

  // Completed tasks
  const completedTasks = tasks.filter(task => task.status === 'completed');
  if (completedTasks.length > 0) {
    suggestions.push({
      type: 'celebration' as const,
      message: `Great job! You've completed ${completedTasks.length} task(s).`,
      action: 'Keep up the momentum!'
    });
  }

  return suggestions;
};

// Helper to detect unscheduled minutes for each task
export function getUnscheduledMinutesForTasks(tasks: Task[], taskScheduledHours: Record<string, number>, settings?: UserSettings) {
  const minSessionLengthHours = settings?.minSessionLength ? settings.minSessionLength / 60 : 0.016; // Default to 1 minute if no settings provided
  
  return tasks
    .filter(task => task.status === 'pending') // Only include pending tasks
    .map(task => {
      const scheduled = taskScheduledHours[task.id] || 0;
      const unscheduled = Math.max(0, task.estimatedHours - scheduled);
      // Only include tasks with unscheduled time above the minimum session length
      return unscheduled > minSessionLengthHours
        ? { 
            taskTitle: task.title, 
            unscheduledMinutes: Math.round(unscheduled * 60),
            importance: task.importance,
            deadline: task.deadline
          }
        : null;
    })
    .filter(Boolean) as Array<{ taskTitle: string; unscheduledMinutes: number; importance: boolean; deadline: string }>;
}

// Time slot calculation functions
interface TimeSlot {
  start: Date;
  end: Date;
}

export const getDailyAvailableTimeSlots = (
  date: Date,
  dailyHours: number,
  commitments: FixedCommitment[],
  workDays: number[],
  startHour: number,
  endHour: number,
  settings?: UserSettings // Add settings parameter to get date-specific study window
): TimeSlot[] => {
  const slots: TimeSlot[] = [];
  const dayOfWeek = date.getDay();
  
  // Check if this is a work day
  if (!workDays.includes(dayOfWeek)) {
    return slots;
  }
  
  const dateString = date.toISOString().split('T')[0];
  
  // Filter commitments for this day using the proper date applicability check
  const dayCommitments = commitments.filter(commitment => {
    return doesCommitmentApplyToDate(commitment, dateString);
  });
  
  // Use date-specific study window if available
  let effectiveStartHour = startHour;
  let effectiveEndHour = endHour;
  
  if (settings) {
    const effectiveWindow = getEffectiveStudyWindow(dateString, settings);
    effectiveStartHour = effectiveWindow.startHour;
    effectiveEndHour = effectiveWindow.endHour;
  }
  
  // Create time slots around commitments
  let currentTime = new Date(date);
  currentTime.setHours(effectiveStartHour, 0, 0, 0);
  
  const endTime = new Date(date);
  endTime.setHours(effectiveEndHour, 0, 0, 0);
  
  // Calculate total available time for the day
  const totalAvailableMinutes = dailyHours * 60;
  let usedMinutes = 0;
  
  // Sort commitments by start time
  const sortedCommitments = dayCommitments.sort((a, b) => {
    const aStartTime = a.modifiedOccurrences?.[dateString]?.startTime || a.startTime || '00:00';
    const bStartTime = b.modifiedOccurrences?.[dateString]?.startTime || b.startTime || '00:00';
    return aStartTime.localeCompare(bStartTime);
  });
  
  for (const commitment of sortedCommitments) {
    const modifiedSession = commitment.modifiedOccurrences?.[dateString];
    
    const commitmentStart = new Date(date);
    const [startHour, startMinute] = (modifiedSession?.startTime || commitment.startTime || '00:00').split(':').map(Number);
    commitmentStart.setHours(startHour, startMinute, 0, 0);
    
    const commitmentEnd = new Date(date);
    const [endHour, endMinute] = (modifiedSession?.endTime || commitment.endTime || '23:59').split(':').map(Number);
    commitmentEnd.setHours(endHour, endMinute, 0, 0);
    
    // Add slot before commitment if there's time
    if (currentTime < commitmentStart) {
      const slotDuration = (commitmentStart.getTime() - currentTime.getTime()) / (1000 * 60);
      if (usedMinutes + slotDuration <= totalAvailableMinutes) {
        slots.push({
          start: currentTime,
          end: commitmentStart
        });
        usedMinutes += slotDuration;
      }
    }
    
    currentTime = commitmentEnd;
  }
  
  // Add final slot if there's time remaining
  if (currentTime < endTime) {
    const remainingMinutes = totalAvailableMinutes - usedMinutes;
    const slotDuration = Math.min(
      (endTime.getTime() - currentTime.getTime()) / (1000 * 60),
      remainingMinutes
    );
    
    if (slotDuration > 0) {
      const slotEnd = new Date(currentTime.getTime() + slotDuration * 60 * 1000);
      slots.push({
        start: currentTime,
        end: slotEnd
      });
    }
  }
  
  return slots;
};

export const findNextAvailableStartTime = (
  startTime: Date,
  durationMinutes: number,
  existingSessions: StudySession[],
  date: Date,
  settings: UserSettings
): Date | null => {
  const dateString = date.toISOString().split('T')[0];
  
  // Use date-specific study window if available
  const effectiveWindow = getEffectiveStudyWindow(dateString, settings);
  
  const studyWindowStart = new Date(date);
  studyWindowStart.setHours(effectiveWindow.startHour, 0, 0, 0);
  
  const studyWindowEnd = new Date(date);
  studyWindowEnd.setHours(effectiveWindow.endHour, 0, 0, 0);
  
  // Check for conflicts with existing sessions
  const proposedEndTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
  
  for (const session of existingSessions) {
    const sessionStart = new Date(date);
    const [startHour, startMinute] = (session.startTime || '00:00').split(':').map(Number);
    sessionStart.setHours(startHour, startMinute, 0, 0);
    
    const sessionEnd = new Date(date);
    const [endHour, endMinute] = (session.endTime || '23:59').split(':').map(Number);
    sessionEnd.setHours(endHour, endMinute, 0, 0);
    
    // Check if there's a conflict
    if (startTime < sessionEnd && proposedEndTime > sessionStart) {
      // Move to after this session
      startTime = sessionEnd;
    }
  }
  
  // Check if the proposed start time is within the study window
  if (startTime >= studyWindowStart && startTime <= studyWindowEnd) {
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    if (endTime <= studyWindowEnd) {
      return startTime;
    }
  }
  
  // If not, return the study window start time
  return studyWindowStart;
};


/**
 * Enhanced skip session function with partial skip support
 */
export const skipSessionEnhanced = (
  studyPlans: StudyPlan[],
  planDate: string,
  sessionNumber: number,
  taskId: string,
  options: {
    partialHours?: number;
    reason?: 'user_choice' | 'conflict' | 'overload';
  } = {}
): boolean => {
  const engine = createEnhancedRedistributionEngine(
    { dailyAvailableHours: 8, workDays: [1,2,3,4,5], bufferDays: 0, minSessionLength: 15, bufferTimeBetweenSessions: 0, shortBreakDuration: 5, longBreakDuration: 15, maxConsecutiveHours: 4, studyWindowStartHour: 6, studyWindowEndHour: 23, avoidTimeRanges: [], weekendStudyHours: 6, autoCompleteSessions: false, enableNotifications: true },
    []
  );
  return engine.skipSession(studyPlans, planDate, sessionNumber, taskId, options);
};

/**
 * Validate time slot for conflicts
 */
export const validateTimeSlot = (
  date: string,
  startTime: string,
  endTime: string,
  existingSessions: StudySession[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[]
) => {
  const checker = createConflictChecker(settings, fixedCommitments);
  return checker.validateTimeSlot(date, startTime, endTime, existingSessions);
};





export const moveIndividualSession = (
  studyPlans: StudyPlan[],
  session: StudySession,
  originalPlanDate: string,
  settings: UserSettings,
  fixedCommitments: FixedCommitment[]
) => {
  const updatedPlans = [...studyPlans];
  const today = getLocalDateString();
  
  // Try to move to today
  const todayPlan = updatedPlans.find(p => p.date === today);
  if (todayPlan && settings.workDays.includes(new Date().getDay())) {
    const availableSlots = getDailyAvailableTimeSlots(
      new Date(today),
      getDaySpecificDailyHours(today, settings),
      fixedCommitments,
      settings.workDays,
      settings.studyWindowStartHour || 6,
      settings.studyWindowEndHour || 23,
      settings
    );
    
    if (availableSlots.length > 0) {
      const newSession = {...session};
      newSession.originalTime = session.startTime;
      newSession.originalDate = originalPlanDate;
      newSession.status = 'scheduled';
      
      // Set new time based on first available slot
      const slot = availableSlots[0];
      const startHour = slot.start.getHours();
      const startMinute = slot.start.getMinutes();
      newSession.startTime = `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`;
      
      const endTime = new Date(slot.start.getTime() + session.allocatedHours * 60 * 60 * 1000);
      const endHour = endTime.getHours();
      const endMinute = endTime.getMinutes();
      newSession.endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`;
      
      todayPlan.plannedTasks.push(newSession);
      
      return { 
        updatedPlans, 
        success: true, 
        newTime: newSession.startTime, 
        newDate: today 
      };
    }
  }
  
  return { 
    updatedPlans, 
    success: false, 
    newTime: null, 
    newDate: null 
  };
};

export const applyUserReschedules = (
  studyPlans: StudyPlan[],
  userReschedules: UserReschedule[]
) => {
  const updatedPlans = [...studyPlans];
  const validReschedules: UserReschedule[] = [];
  const obsoleteReschedules: UserReschedule[] = [];
  
  for (const reschedule of userReschedules) {
    // Check if the original session still exists
    const originalPlan = updatedPlans.find(p => p.date === reschedule.originalPlanDate);
    const originalSession = originalPlan?.plannedTasks.find(s => 
      s.taskId === reschedule.taskId && s.sessionNumber === reschedule.sessionNumber
    );
    
    if (!originalSession) {
      obsoleteReschedules.push(reschedule);
      continue;
    }
    
    // Apply the reschedule
    const targetPlan = updatedPlans.find(p => p.date === reschedule.newPlanDate);
    if (targetPlan) {
      const newSession = {...originalSession};
      newSession.startTime = reschedule.newStartTime;
      newSession.endTime = reschedule.newEndTime;
      newSession.originalTime = reschedule.originalStartTime;
      newSession.originalDate = reschedule.originalPlanDate;
      newSession.status = 'rescheduled';
      
      targetPlan.plannedTasks.push(newSession);
      validReschedules.push(reschedule);
    }
  }
  
  return { 
    updatedPlans, 
    validReschedules, 
    obsoleteReschedules 
  };
};

export const createUserReschedule = (
  session: StudySession,
  originalDate: string,
  newDate: string,
  newStartTime: string,
  newEndTime: string
): UserReschedule => {
  // Implementation for creating user reschedules
  return {
    id: Date.now().toString(),
    originalSessionId: `${session.taskId}-${session.sessionNumber}`,
    originalPlanDate: originalDate,
    originalStartTime: session.startTime,
    originalEndTime: session.endTime,
    newPlanDate: newDate,
    newStartTime,
    newEndTime,
    rescheduledAt: new Date().toISOString(),
    status: 'active' as const,
    taskId: session.taskId,
    sessionNumber: session.sessionNumber || 0
  };
};

export const validateUserReschedules = (userReschedules: UserReschedule[]) => {
  const validReschedules: UserReschedule[] = [];
  const obsoleteReschedules: UserReschedule[] = [];
  
  for (const reschedule of userReschedules) {
    // Basic validation
    if (reschedule.originalPlanDate && reschedule.newPlanDate && 
        reschedule.newStartTime && reschedule.newEndTime) {
      validReschedules.push(reschedule);
    } else {
      obsoleteReschedules.push(reschedule);
    }
  }
  
  return { validReschedules, obsoleteReschedules };
};

// New function to aggressively redistribute tasks after deletion
export const redistributeAfterTaskDeletion = (
  tasks: Task[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[],
  existingStudyPlans: StudyPlan[]
): StudyPlan[] => {
  if (settings.studyPlanMode !== 'even') {
    // For smart mode, just regenerate from scratch, preserving manual schedules
    const { plans } = generateNewStudyPlanWithPreservation(tasks, settings, fixedCommitments, existingStudyPlans);
    return plans;
  }

  // For even mode, do aggressive redistribution
  const tasksEven = tasks
    .filter(task => task.status === 'pending' && task.estimatedHours > 0)
    .sort((a, b) => {
      if (a.importance !== b.importance) return a.importance ? -1 : 1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

  // Get available days (same logic as generateNewStudyPlan)
  const now = new Date();
  const latestDeadline = new Date(Math.max(...tasksEven.map(t => new Date(t.deadline).getTime())));
  const availableDays: string[] = [];
  const tempDate = new Date(now);
  while (tempDate <= latestDeadline) {
    const dateStr = tempDate.toISOString().split('T')[0];
    const dayOfWeek = tempDate.getDay();
    if (settings.workDays.includes(dayOfWeek)) {
      availableDays.push(dateStr);
    }
    tempDate.setDate(tempDate.getDate() + 1);
  }

  // Include deadline days
  if (settings.bufferDays === 0) {
    tasksEven.forEach(task => {
      const deadlineDateStr = new Date(task.deadline).toISOString().split('T')[0];
      if (!availableDays.includes(deadlineDateStr) && settings.workDays.includes(new Date(deadlineDateStr).getDay())) {
        availableDays.push(deadlineDateStr);
      }
    });
  } else {
    tasksEven.forEach(task => {
      const deadline = new Date(task.deadline);
      deadline.setDate(deadline.getDate() - settings.bufferDays);
      const deadlineDateStr = deadline.toISOString().split('T')[0];
      if (!availableDays.includes(deadlineDateStr) && settings.workDays.includes(new Date(deadlineDateStr).getDay())) {
        availableDays.push(deadlineDateStr);
      }
    });
  }
  availableDays.sort();

  // Create fresh study plans with full daily capacity
  const studyPlans: StudyPlan[] = [];
  const dailyRemainingHours: { [date: string]: number } = {};
  availableDays.forEach(date => {
    // Calculate committed hours for this date that count toward daily hours
    const committedHours = calculateCommittedHoursForDate(date, fixedCommitments);
    const availableHoursAfterCommitments = Math.max(0, getDaySpecificDailyHours(date, settings) - committedHours);

    dailyRemainingHours[date] = availableHoursAfterCommitments;
    studyPlans.push({
      id: `plan-${date}`,
      date,
      plannedTasks: [],
      totalStudyHours: 0,
      availableHours: availableHoursAfterCommitments
    });
  });

  // Account for existing sessions (excluding missed, redistributed, and completed sessions from daily limit)
  existingStudyPlans.forEach(plan => {
    if (availableDays.includes(plan.date)) {
      plan.plannedTasks.forEach(session => {
        if (session.status !== 'skipped' && !session.done && session.status !== 'completed') {
          // Only count non-completed sessions toward daily capacity
          if (!isMissedOrRedistributedSession(session, plan.date)) {
            dailyRemainingHours[plan.date] -= session.allocatedHours;
          }
        }
      });
    }
  });

  // Helper function to redistribute unscheduled hours (same as in generateNewStudyPlan)
  const redistributeUnscheduledHours = (task: Task, unscheduledHours: number, daysForTask: string[]) => {
    let remainingUnscheduledHours = unscheduledHours;
    let redistributionRound = 0;
    const maxRedistributionRounds = 10;
    const minSessionLength = (settings.minSessionLength || 15) / 60;
    const maxSessionLength = Math.min(4, settings.dailyAvailableHours);
    
    while (remainingUnscheduledHours > 0 && redistributionRound < maxRedistributionRounds) {
      redistributionRound++;
      
      const availableDaysForRedistribution = daysForTask.filter(date => {
        return dailyRemainingHours[date] > 0;
      });
      
      if (availableDaysForRedistribution.length === 0) {
        break;
      }
      
      let distributedThisRound = 0;
      const optimalSessions = optimizeSessionDistribution(task, remainingUnscheduledHours, availableDaysForRedistribution, settings);
      
      for (let i = 0; i < optimalSessions.length && i < availableDaysForRedistribution.length; i++) {
        const date = availableDaysForRedistribution[i];
        const dayPlan = studyPlans.find(p => p.date === date)!;
        const availableHours = dailyRemainingHours[date];
        const sessionLength = Math.min(optimalSessions[i], availableHours);
        
        if (sessionLength >= minSessionLength) {
          const roundedSessionLength = Math.round(sessionLength * 60) / 60;
          dayPlan.plannedTasks.push({
            taskId: task.id,
            scheduledTime: `${date}`,
            startTime: '',
            endTime: '',
            allocatedHours: roundedSessionLength,
            sessionNumber: (dayPlan.plannedTasks.filter(s => s.taskId === task.id).length) + 1,
            isFlexible: true,
            status: 'scheduled'
          });
          dayPlan.totalStudyHours = Math.round((dayPlan.totalStudyHours + roundedSessionLength) * 60) / 60;
          dailyRemainingHours[date] = Math.round((dailyRemainingHours[date] - roundedSessionLength) * 60) / 60;
          distributedThisRound = Math.round((distributedThisRound + roundedSessionLength) * 60) / 60;
        }
      }
      
      remainingUnscheduledHours -= distributedThisRound;
      
      if (distributedThisRound === 0) {
        break;
      }
    }
    
    return remainingUnscheduledHours;
  };

  // Helper function to combine sessions of the same task on the same day
  const combineSessionsOnSameDay = (studyPlans: StudyPlan[]) => {
    for (const plan of studyPlans) {
      // Group sessions by taskId, excluding skipped sessions from combination
      const sessionsByTask: { [taskId: string]: StudySession[] } = {};
      
      plan.plannedTasks.forEach(session => {
        // Skip sessions that are completed/skipped/done - they shouldn't be combined with other sessions
        if (session.status === 'skipped' || session.status === 'completed' || session.done) {
          return;
        }
        
        if (!sessionsByTask[session.taskId]) {
          sessionsByTask[session.taskId] = [];
        }
        sessionsByTask[session.taskId].push(session);
      });
      
      const combinedSessions: StudySession[] = [];
      
      // Combine sessions for each task
      Object.entries(sessionsByTask).forEach(([taskId, sessions]) => {
        if (sessions.length > 1) {
          // Sort sessions by start time
          sessions.sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));
          
          // Combine all sessions into one
          const firstSession = sessions[0];
          const lastSession = sessions[sessions.length - 1];
          const totalHours = sessions.reduce((sum, session) => sum + session.allocatedHours, 0);
          
          const combinedSession: StudySession = {
            ...firstSession,
            startTime: firstSession.startTime,
            endTime: lastSession.endTime,
            allocatedHours: totalHours,
            sessionNumber: 1 // Combined session gets number 1
          };
          
          combinedSessions.push(combinedSession);
        } else {
          // Single session, keep as is
          combinedSessions.push(sessions[0]);
        }
      });
      
      // Update the plan with combined sessions (keeping skipped sessions separate)
        const skippedSessions = plan.plannedTasks.filter(session => session.status === 'skipped');
        plan.plannedTasks = [...combinedSessions, ...skippedSessions];

        // Calculate totalStudyHours based on all planned session durations
        plan.totalStudyHours = plan.plannedTasks.reduce((sum, s) => sum + s.allocatedHours, 0);
    }
  };



  // AGGRESSIVE REDISTRIBUTION: Distribute all tasks optimally
  for (const task of tasksEven) {
    const deadline = new Date(task.deadline);
    if (settings.bufferDays > 0) {
      deadline.setDate(deadline.getDate() - settings.bufferDays);
    }
    const deadlineDateStr = deadline.toISOString().split('T')[0];
    const startDateStrD = (task as any).startDate || now.toISOString().split('T')[0];
    const daysForTask = availableDays.filter(d => d >= startDateStrD && d <= deadlineDateStr);
    
    if (daysForTask.length === 0) {
      continue;
    }
    
    let totalHours = task.estimatedHours;
    const sessionLengths = optimizeSessionDistribution(task, totalHours, daysForTask, settings);
    
    let unscheduledHours = 0;
    for (let i = 0; i < sessionLengths.length && i < daysForTask.length; i++) {
      const date = daysForTask[i];
      let dayPlan = studyPlans.find(p => p.date === date)!;
      let availableHours = dailyRemainingHours[date];
      const thisSessionLength = Math.min(sessionLengths[i], availableHours);
      
      if (thisSessionLength > 0) {
        const roundedSessionLength = Math.round(thisSessionLength * 60) / 60;
        dayPlan.plannedTasks.push({
          taskId: task.id,
          scheduledTime: `${date}`,
          startTime: '',
          endTime: '',
          allocatedHours: roundedSessionLength,
          sessionNumber: (dayPlan.plannedTasks.filter(s => s.taskId === task.id).length) + 1,
          isFlexible: true,
          status: 'scheduled'
        });
        dayPlan.totalStudyHours = Math.round((dayPlan.totalStudyHours + roundedSessionLength) * 60) / 60;
        dailyRemainingHours[date] = Math.round((dailyRemainingHours[date] - roundedSessionLength) * 60) / 60;
        totalHours = Math.round((totalHours - roundedSessionLength) * 60) / 60;
      } else {
        unscheduledHours += sessionLengths[i];
      }
    }
    
    // Redistribute any unscheduled hours
    if (unscheduledHours > 0) {
      redistributeUnscheduledHours(task, unscheduledHours, daysForTask);
    }
  }
  
  // Combine sessions
  combineSessionsOnSameDay(studyPlans);
  
  // MULTIPLE GLOBAL REDISTRIBUTION PASSES for maximum filling
  let redistributionPasses = 0;
  const maxRedistributionPasses = 3;
  
  while (redistributionPasses < maxRedistributionPasses) {
    redistributionPasses++;
    
    // Calculate current scheduled hours (including skipped sessions to prevent redistribution)
    let taskScheduledHours: { [taskId: string]: number } = {};
    for (const plan of studyPlans) {
      for (const session of plan.plannedTasks) {
        // Include all sessions (including skipped) so their durations are preserved and not redistributed
        taskScheduledHours[session.taskId] = (taskScheduledHours[session.taskId] || 0) + session.allocatedHours;
      }
    }

    // Find tasks with unscheduled hours
    const tasksWithUnscheduledHours = tasksEven.filter(task => {
      const scheduledHours = taskScheduledHours[task.id] || 0;
      return task.estimatedHours - scheduledHours > 0.016; // More than 1 minute
    });
    
    if (tasksWithUnscheduledHours.length === 0) {
      break; // No more unscheduled hours to redistribute
    }
    
    // Sort by importance and deadline
    const sortedTasksForRedistribution = tasksWithUnscheduledHours.sort((a, b) => {
      if (a.importance !== b.importance) return a.importance ? -1 : 1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
    
    let redistributedThisPass = false;
    
    for (const task of sortedTasksForRedistribution) {
      const scheduledHours = taskScheduledHours[task.id] || 0;
      const unscheduledHours = task.estimatedHours - scheduledHours;
      
      if (unscheduledHours <= 0) continue;
      
      const deadline = new Date(task.deadline);
      if (settings.bufferDays > 0) {
        deadline.setDate(deadline.getDate() - settings.bufferDays);
      }
      const deadlineDateStr = deadline.toISOString().split('T')[0];
      const startDateStrD = (task as any).startDate || now.toISOString().split('T')[0];
      const daysForTask = availableDays.filter(d => d >= startDateStrD && d <= deadlineDateStr);
      
      const finalUnscheduledHours = redistributeUnscheduledHours(task, unscheduledHours, daysForTask);
      
      if (finalUnscheduledHours < unscheduledHours) {
        redistributedThisPass = true;
      }
    }
    
    // If nothing was redistributed this pass, stop
    if (!redistributedThisPass) {
      break;
    }
    
    // Recombine sessions after each pass
    combineSessionsOnSameDay(studyPlans);
  }
  
  // Assign time slots
  for (const plan of studyPlans) {
    plan.plannedTasks.sort((a, b) => {
      const taskA = tasksEven.find(t => t.id === a.taskId);
      const taskB = tasksEven.find(t => t.id === b.taskId);
      if (!taskA || !taskB) return 0;
      if (taskA.importance !== taskB.importance) return taskA.importance ? -1 : 1;
      return new Date(taskA.deadline).getTime() - new Date(taskB.deadline).getTime();
    });
    
            const commitmentsForDay = fixedCommitments.filter(commitment => {
          return doesCommitmentApplyToDate(commitment, plan.date);
        });
    let assignedSessions: StudySession[] = [];
    
    for (const session of plan.plannedTasks) {
      const slot = findNextAvailableTimeSlot(
        session.allocatedHours,
        assignedSessions,
        commitmentsForDay,
        settings.studyWindowStartHour || 6,
        settings.studyWindowEndHour || 23,
        settings.bufferTimeBetweenSessions || 0, // pass buffer
        plan.date // pass target date for filtering deleted occurrences
      );
      if (slot) {
        session.startTime = slot.start;
        session.endTime = slot.end;
        assignedSessions.push(session);
      } else {
        session.startTime = '';
        session.endTime = '';
      }
    }
  }
  
  return studyPlans;
};

// Function to check for time conflicts between commitments
export const checkCommitmentConflicts = (
  newCommitment: {
    startTime?: string;
    endTime?: string;
    recurring: boolean;
    daysOfWeek: number[];
    specificDates?: string[];
    isAllDay?: boolean;
    dateRange?: {
      startDate: string;
      endDate: string;
    };
    type?: string; // Added type to check for all-day events
  },
  existingCommitments: FixedCommitment[],
  excludeCommitmentId?: string // For editing, exclude the commitment being edited
): { 
  hasConflict: boolean; 
  conflictingCommitment?: FixedCommitment;
  conflictType?: 'strict' | 'override';
  conflictingDates?: string[];
} => {
  // Convert time strings to minutes for easier comparison
  const timeToMinutes = (timeStr?: string): number => {
    if (!timeStr) return 0; // For all-day events
    const [hours, minutes] = timeStr.split(':').map(Number);
    return (hours || 0) * 60 + (minutes || 0);
  };

  // For all-day events, use full day time range (00:00 to 23:59)
  const newStartMinutes = newCommitment.isAllDay ? 0 : timeToMinutes(newCommitment.startTime);
  const newEndMinutes = newCommitment.isAllDay ? 24 * 60 - 1 : timeToMinutes(newCommitment.endTime);

  // Check each existing commitment for conflicts
  for (const existing of existingCommitments) {
    // Skip the commitment being edited
    if (excludeCommitmentId && existing.id === excludeCommitmentId) {
      continue;
    }

    let hasConflict = false;
    let conflictType: 'strict' | 'override' = 'strict';
    let conflictingDates: string[] = [];

    // Allow all-day recurring commitments to coexist with other commitments
    // This is the key change to allow all-day events even when there are existing commitments
    if (newCommitment.recurring && newCommitment.isAllDay) {
      // All-day recurring commitments are allowed to overlap with existing commitments
      // We'll skip conflict detection for these
      continue;
    }

    if (newCommitment.recurring && existing.recurring) {
      // Both are recurring - STRICT conflict (same type)
      const hasOverlappingDays = newCommitment.daysOfWeek.some(day => 
        existing.daysOfWeek.includes(day)
      );

      // IMPROVED: Check actual date range overlap with proper logic
      let dateRangeOverlap = false;
      
      if (newCommitment.dateRange?.startDate && newCommitment.dateRange?.endDate && 
          existing.dateRange?.startDate && existing.dateRange?.endDate) {
        // Both have date ranges - check if they actually overlap
        dateRangeOverlap = !(
          newCommitment.dateRange.endDate < existing.dateRange.startDate || 
          newCommitment.dateRange.startDate > existing.dateRange.endDate
        );
      } else if (newCommitment.dateRange?.startDate && newCommitment.dateRange?.endDate) {
        // New commitment has date range, existing doesn't (existing is indefinite)
        // They overlap because existing applies to all dates
        dateRangeOverlap = true;
      } else if (existing.dateRange?.startDate && existing.dateRange?.endDate) {
        // Existing commitment has date range, new doesn't (new is indefinite)
        // They overlap because new applies to all dates
        dateRangeOverlap = true;
      } else {
        // Neither has date range (both are indefinite) - they overlap
        dateRangeOverlap = true;
      }

      // Skip conflict detection if the existing commitment is an all-day event
      if (existing.isAllDay) {
        continue;
      }

      if (hasOverlappingDays && dateRangeOverlap) {
        const existingStartMinutes = existing.isAllDay ? 0 : timeToMinutes(existing.startTime);
        const existingEndMinutes = existing.isAllDay ? 24 * 60 - 1 : timeToMinutes(existing.endTime);

        // If there's a time overlap (we already handled all-day events above)
        const hasTimeOverlap = 
          !(
            newEndMinutes <= existingStartMinutes || 
            newStartMinutes >= existingEndMinutes
          );

        if (hasTimeOverlap) {
          hasConflict = true;
          conflictType = 'strict';
        }
      }
    } else if (!newCommitment.recurring && !existing.recurring) {
      // Both are non-recurring - STRICT conflict (same type)
      const hasOverlappingDates = newCommitment.specificDates?.some(date => 
        existing.specificDates?.includes(date)
      );

      // Skip conflict detection if either commitment is an all-day event
      if (newCommitment.isAllDay || existing.isAllDay) {
        continue;
      }

      if (hasOverlappingDates) {
        const existingStartMinutes = timeToMinutes(existing.startTime);
        const existingEndMinutes = timeToMinutes(existing.endTime);

        // Check for time overlap (we already handled all-day events above)
        const hasTimeOverlap = !(
          newEndMinutes <= existingStartMinutes || 
          newStartMinutes >= existingEndMinutes
        );

        if (hasTimeOverlap) {
          hasConflict = true;
          conflictType = 'strict';
          conflictingDates = newCommitment.specificDates?.filter(date => 
            existing.specificDates?.includes(date)
          ) || [];
        }
      }
    } else {
      // One is recurring, one is non-recurring
      if (newCommitment.recurring && !existing.recurring) {
        // Skip conflict detection if new commitment is an all-day event
        if (newCommitment.isAllDay) {
          continue;
        }
        
        // Skip conflict detection if existing commitment is an all-day event
        if (existing.isAllDay) {
          continue;
        }
        
        // New is recurring, existing is non-recurring - OVERRIDE (one-time takes priority)
        // IMPROVED: Use doesCommitmentApplyToDate logic for better date range handling
        const overlappingDates = existing.specificDates?.filter(date => {
          const dayOfWeek = new Date(date).getDay();
          const isInDayOfWeek = newCommitment.daysOfWeek.includes(dayOfWeek);
          
          // CRITICAL: Only check date range if the day of week matches first
          if (!isInDayOfWeek) return false;
          
          // Check if date is within the new commitment's date range if specified
          let isInDateRange = true;
          if (newCommitment.dateRange?.startDate && newCommitment.dateRange?.endDate) {
            // Add one day to endDate to include the full last day
            const endDateObj = new Date(newCommitment.dateRange.endDate);
            endDateObj.setDate(endDateObj.getDate() + 1);
            const inclusiveEndDate = endDateObj.toISOString().split('T')[0];
            isInDateRange = (
              date >= newCommitment.dateRange.startDate && 
              date < inclusiveEndDate
            );
          }
          
          return isInDateRange; // Both day of week and date range must match
        }) || [];

        if (overlappingDates.length > 0) {
          const existingStartMinutes = timeToMinutes(existing.startTime);
          const existingEndMinutes = timeToMinutes(existing.endTime);

          // Check for time overlap (we already handled all-day events above)
          const hasTimeOverlap = !(
            newEndMinutes <= existingStartMinutes || 
            newStartMinutes >= existingEndMinutes
          );

          if (hasTimeOverlap) {
            hasConflict = true;
            conflictType = 'override';
            conflictingDates = overlappingDates;
          }
        }
      } else {
        // Skip conflict detection if new commitment is an all-day event
        if (newCommitment.isAllDay) {
          continue;
        }
        
        // Skip conflict detection if existing commitment is an all-day event
        if (existing.isAllDay) {
          continue;
        }
        
        // New is non-recurring, existing is recurring - OVERRIDE (one-time takes priority)
        // IMPROVED: Use doesCommitmentApplyToDate logic for better date range handling
        const overlappingDates = newCommitment.specificDates?.filter(date => {
          const dayOfWeek = new Date(date).getDay();
          const isInDayOfWeek = existing.daysOfWeek.includes(dayOfWeek);
          
          // CRITICAL: Only check date range if the day of week matches first
          if (!isInDayOfWeek) return false;
          
          // Check if date is within the existing commitment's date range if specified  
          let isInDateRange = true;
          if (existing.dateRange?.startDate && existing.dateRange?.endDate) {
            // Add one day to endDate to include the full last day
            const endDateObj = new Date(existing.dateRange.endDate);
            endDateObj.setDate(endDateObj.getDate() + 1);
            const inclusiveEndDate = endDateObj.toISOString().split('T')[0];
            isInDateRange = (
              date >= existing.dateRange.startDate && 
              date < inclusiveEndDate
            );
          }
          
          return isInDateRange; // Both day of week and date range must match
        }) || [];

        if (overlappingDates.length > 0) {
          const existingStartMinutes = timeToMinutes(existing.startTime);
          const existingEndMinutes = timeToMinutes(existing.endTime);

          // Check for time overlap (we already handled all-day events above)
          const hasTimeOverlap = !(
            newEndMinutes <= existingStartMinutes || 
            newStartMinutes >= existingEndMinutes
          );

          if (hasTimeOverlap) {
            hasConflict = true;
            conflictType = 'override';
            conflictingDates = overlappingDates;
          }
        }
      }
    }

    if (hasConflict) {
      return {
        hasConflict: true,
        conflictingCommitment: existing,
        conflictType,
        conflictingDates
      };
    }
  }

  return { hasConflict: false };
};

// Enhanced session combination function with conflict validation
const combineSessionsOnSameDayWithValidation = (studyPlans: StudyPlan[], settings: UserSettings) => {
  for (const plan of studyPlans) {
    // Group sessions by taskId, excluding skipped sessions from combination
    const sessionsByTask: { [taskId: string]: StudySession[] } = {};
    
    plan.plannedTasks.forEach(session => {
      // Skip sessions that are marked as skipped - they shouldn't be combined with other sessions
      if (session.status === 'skipped') {
        return;
      }
      
      if (!sessionsByTask[session.taskId]) {
        sessionsByTask[session.taskId] = [];
      }
      sessionsByTask[session.taskId].push(session);
    });
    
    const combinedSessions: StudySession[] = [];
    
    // Combine sessions for each task with validation
    Object.entries(sessionsByTask).forEach(([taskId, sessions]) => {
      if (sessions.length > 1) {
        // Sort sessions by start time
        sessions.sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));
        
        // Calculate total hours
        const totalHours = sessions.reduce((sum, session) => sum + session.allocatedHours, 0);
        
        // Validate session length constraints
        const minSessionLength = (settings.minSessionLength || 15) / 60; // in hours
        const maxSessionLength = Math.min(4, settings.dailyAvailableHours);
        
        if (totalHours >= minSessionLength && totalHours <= maxSessionLength) {
          // Combine all sessions into one
          const firstSession = sessions[0];
          const lastSession = sessions[sessions.length - 1];
          
          const combinedSession: StudySession = {
            ...firstSession,
            startTime: firstSession.startTime,
            endTime: lastSession.endTime,
            allocatedHours: totalHours,
            sessionNumber: 1 // Combined session gets number 1
          };
          
          combinedSessions.push(combinedSession);
        } else {
          // If combination would violate constraints, keep sessions separate
          combinedSessions.push(...sessions);
        }
      } else {
        // Single session, keep as is
        combinedSessions.push(...sessions);
      }
    });
    
    // Update plan with combined sessions
    plan.plannedTasks = combinedSessions;
    plan.totalStudyHours = combinedSessions.reduce((sum, session) => sum + session.allocatedHours, 0);
  }
};

/**
 * Preserves manual schedules from existing study plans when generating new ones
 * This ensures that manually rescheduled sessions maintain their exact positions
 * and are treated as fixed constraints by the scheduling algorithm
 */
export const preserveManualSchedules = (
  newPlans: StudyPlan[],
  existingPlans: StudyPlan[],
  options: { preserveManualReschedules?: boolean } = { preserveManualReschedules: true }
): StudyPlan[] => {
  // Create a map of manually rescheduled sessions by their unique identifier
  const manualSchedules = new Map<string, StudySession>();

  existingPlans.forEach(plan => {
    plan.plannedTasks.forEach(session => {
      if (session.originalTime && session.originalDate && session.isManualOverride) {
        const key = `${session.taskId}-${session.sessionNumber}`;
        manualSchedules.set(key, { ...session });
      }
    });
  });

  const preserveManual = options.preserveManualReschedules !== false;

  // Apply manual schedule preservation to new plans
  newPlans.forEach(plan => {
    const prevPlan = existingPlans.find(p => p.date === plan.date);
    if (!prevPlan) return;

    plan.plannedTasks.forEach(session => {
      const prevSession = prevPlan.plannedTasks.find(s =>
        s.taskId === session.taskId && s.sessionNumber === session.sessionNumber
      );

      if (prevSession) {
        // Preserve done sessions
        if (prevSession.done) {
          session.done = true;
          session.status = prevSession.status;
          session.actualHours = prevSession.actualHours;
          session.completedAt = prevSession.completedAt;
        }
        // Preserve skipped sessions (including their duration and time)
        else if (prevSession.status === 'skipped') {
          session.status = 'skipped';
          session.allocatedHours = prevSession.allocatedHours;
          session.startTime = prevSession.startTime;
          session.endTime = prevSession.endTime;
          session.skipMetadata = prevSession.skipMetadata;
        }
        // Preserve manual reschedules with their exact positions (optional)
        else if (preserveManual && prevSession.originalTime && prevSession.originalDate && prevSession.isManualOverride) {
          // Preserve all the original reschedule metadata
          session.originalTime = prevSession.originalTime;
          session.originalDate = prevSession.originalDate;
          session.rescheduledAt = prevSession.rescheduledAt;
          session.isManualOverride = prevSession.isManualOverride;

          // Preserve the actual rescheduled times and positions
          session.startTime = prevSession.startTime;
          session.endTime = prevSession.endTime;

          // If the session was moved to a different date, ensure it stays there
          if (prevSession.originalDate !== plan.date) {
            const targetPlan = newPlans.find(p => p.date === prevSession.originalDate);
            if (targetPlan) {
              // Move session to the correct plan
              targetPlan.plannedTasks.push(session);
              plan.plannedTasks = plan.plannedTasks.filter(s => s !== session);
            }
          }
        }
        // Preserve other rescheduled sessions metadata (optional)
        else if (preserveManual && prevSession.originalTime && prevSession.originalDate) {
          session.originalTime = prevSession.originalTime;
          session.originalDate = prevSession.originalDate;
          session.rescheduledAt = prevSession.rescheduledAt;
          session.isManualOverride = prevSession.isManualOverride;
        }

        // PRESERVE ALL EXISTING SESSION DURATIONS unless they were completed/skipped
        // This ensures that existing scheduled sessions maintain their allocated hours during regeneration
        if (!prevSession.done && prevSession.status !== 'completed' && prevSession.status !== 'skipped') {
          session.allocatedHours = prevSession.allocatedHours;

          // Also recalculate end time based on preserved duration
          if (session.startTime && session.allocatedHours) {
            const [startHour, startMinute] = session.startTime.split(':').map(Number);
            const durationMinutes = Math.round(session.allocatedHours * 60);
            const endTime = new Date();
            endTime.setHours(startHour, startMinute + durationMinutes, 0, 0);
            session.endTime = `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;
          }
        }
      }
    });
  });

  // Final pass: ensure skipped/completed/done sessions from previous plans are preserved
  existingPlans.forEach(prevPlan => {
    const targetPlan = newPlans.find(p => p.date === prevPlan.date);
    if (!targetPlan) return;

    prevPlan.plannedTasks.forEach(prevSession => {
      const isFixed = prevSession.done || prevSession.status === 'completed' || prevSession.status === 'skipped';
      if (!isFixed) return;

      const existsInNew = targetPlan.plannedTasks.some(s => s.taskId === prevSession.taskId && s.sessionNumber === prevSession.sessionNumber);
      if (!existsInNew) {
        // Append the fixed session exactly as it was to preserve user intent
        targetPlan.plannedTasks.push({ ...prevSession });
        targetPlan.totalStudyHours = Math.round((targetPlan.totalStudyHours + prevSession.allocatedHours) * 60) / 60;
      }
    });
  });

  return newPlans;
};

// Ensures that fixed sessions (completed/skipped) from existing plans remain intact
// after any subsequent balancing/smoothing passes. If a fixed session is missing
// in the new plans, it will be appended; if present, its status/timing/duration will be enforced.
const preserveFixedSessionsPostProcessing = (
  newPlans: StudyPlan[],
  existingPlans: StudyPlan[]
): StudyPlan[] => {
  const result = newPlans.map(p => ({ ...p, plannedTasks: [...p.plannedTasks] }));
  const today = getLocalDateString();

  existingPlans.forEach(prevPlan => {
    let targetPlan = result.find(p => p.date === prevPlan.date);

    // If the day doesn't exist in the new plans but the previous plan contains fixed sessions,
    // re-introduce that day with only the fixed sessions to preserve history/audit trail.
    if (!targetPlan) {
      const fixedSessions = prevPlan.plannedTasks.filter(s => s.done || s.status === 'completed' || s.status === 'skipped');
      if (fixedSessions.length > 0) {
        result.push({
          id: prevPlan.id,
          date: prevPlan.date,
          plannedTasks: fixedSessions.map(s => ({ ...s })),
          totalStudyHours: calculateTotalStudyHours(fixedSessions),
          availableHours: prevPlan.availableHours,
          isOverloaded: prevPlan.isOverloaded,
        });
      }
      return; // Nothing more to do for days that weren't regenerated
    }

    prevPlan.plannedTasks.forEach(prevSession => {
      const isFixed = prevSession.done || prevSession.status === 'completed' || prevSession.status === 'skipped';
      if (!isFixed) return;

      const idx = targetPlan!.plannedTasks.findIndex(s => s.taskId === prevSession.taskId && s.sessionNumber === prevSession.sessionNumber);
      if (idx === -1) {
        targetPlan!.plannedTasks.push({ ...prevSession });
        targetPlan!.totalStudyHours = Math.round((targetPlan!.totalStudyHours + prevSession.allocatedHours) * 60) / 60;
      } else {
        const session = targetPlan!.plannedTasks[idx];
        targetPlan!.plannedTasks[idx] = {
          ...session,
          status: prevSession.status,
          done: prevSession.done,
          actualHours: prevSession.actualHours,
          completedAt: prevSession.completedAt,
          allocatedHours: prevSession.allocatedHours,
          startTime: prevSession.startTime,
          endTime: prevSession.endTime,
          skipMetadata: prevSession.skipMetadata,
          originalTime: prevSession.originalTime,
          originalDate: prevSession.originalDate,
          rescheduledAt: prevSession.rescheduledAt,
          isManualOverride: prevSession.isManualOverride,
        };
      }
    });
  });

  // Sort plans by date to keep chronological order
  result.sort((a, b) => a.date.localeCompare(b.date));

  return result;
};

/**
 * Enhanced study plan generation that respects existing manual schedules
 * This function ensures that manually rescheduled sessions are treated as
 * fixed constraints when generating new schedules
 */
/**
 * Handles fallback scenarios when one-sitting tasks can't be scheduled as intended
 */
const handleOneSittingFallback = (
  task: Task,
  totalHours: number,
  daysForTask: string[],
  dailyRemainingHours: { [date: string]: number },
  settings: UserSettings
): {
  scheduled: boolean;
  scheduledSessions: Array<{ date: string; hours: number }>;
  totalScheduled: number;
} => {
  const result: Array<{ date: string; hours: number }> = [];
  let remainingHours = totalHours;
  const minSessionLength = (settings.minSessionLength || 15) / 60;

  // Strategy 1: Try to split into 2 large sessions (maintain large blocks)
  if (remainingHours > 2 && daysForTask.length >= 2) {
    const halfHours = remainingHours / 2;
    let scheduledSessions = 0;

    for (let i = daysForTask.length - 1; i >= 0 && scheduledSessions < 2; i--) {
      const date = daysForTask[i];
      const availableHours = dailyRemainingHours[date];

      if (availableHours >= halfHours) {
        result.push({ date, hours: halfHours });
        remainingHours -= halfHours;
        scheduledSessions++;
      }
    }

    if (scheduledSessions === 2) {
      return {
        scheduled: true,
        scheduledSessions: result,
        totalScheduled: totalHours - remainingHours
      };
    }
  }

  // Strategy 2: Progressive scheduling (largest possible sessions first)
  result.length = 0; // Clear previous attempts
  remainingHours = totalHours;

  // Sort days by available capacity (descending) and proximity to deadline
  const sortedDays = [...daysForTask].sort((a, b) => {
    const aCapacity = dailyRemainingHours[a];
    const bCapacity = dailyRemainingHours[b];

    if (Math.abs(aCapacity - bCapacity) > 0.5) {
      return bCapacity - aCapacity; // More capacity first
    }

    // If capacity is similar, prefer closer to deadline
    return b.localeCompare(a);
  });

  for (const date of sortedDays) {
    if (remainingHours <= 0) break;

    const availableHours = dailyRemainingHours[date];
    if (availableHours >= minSessionLength) {
      const hoursToSchedule = Math.min(remainingHours, availableHours);

      if (hoursToSchedule >= minSessionLength) {
        result.push({ date, hours: hoursToSchedule });
        remainingHours -= hoursToSchedule;
      }
    }
  }

  return {
    scheduled: result.length > 0,
    scheduledSessions: result,
    totalScheduled: totalHours - remainingHours
  };
};

/**
 * Rebalances non-one-sitting tasks around large one-sitting tasks to create consistent daily workloads
 */
const rebalanceAroundOneSittingTasks = (
  studyPlans: StudyPlan[],
  tasks: Task[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[]
): StudyPlan[] => {
  // Step 1: Identify days with large one-sitting tasks using a more permissive threshold
  // Use day-specific capacity and mark days only when one-sitting occupies >=80% of that day's capacity
  const daysWithLargeOneSittingTasks = new Set<string>();
  const oneSittingTasksByDay = new Map<string, StudySession[]>();

  for (const plan of studyPlans) {
    const dayCapacity = getDaySpecificDailyHours(plan.date, settings);
    const capacityThreshold = dayCapacity * 0.8; // relax rigidity: only rebalance when truly dominant

    const oneSittingSessions = plan.plannedTasks.filter(session => {
      const task = tasks.find(t => t.id === session.taskId);
      return task?.isOneTimeTask && session.allocatedHours >= capacityThreshold;
    });

    if (oneSittingSessions.length > 0) {
      daysWithLargeOneSittingTasks.add(plan.date);
      oneSittingTasksByDay.set(plan.date, oneSittingSessions);
    }
  }

  // If no large one-sitting tasks, return original plans
  if (daysWithLargeOneSittingTasks.size === 0) {
    return studyPlans;
  }

  // Step 2: Extract non-one-sitting sessions from overloaded days
  const sessionsToRebalance: Array<{
    session: StudySession;
    task: Task;
    originalDate: string;
  }> = [];

  const rebalancedPlans = studyPlans.map(plan => {
    if (!daysWithLargeOneSittingTasks.has(plan.date)) {
      return plan;
    }

    // Only rebalance if remaining capacity after keeping all sessions is below a small reserve (e.g., <1h)
    const dayCapacity = getDaySpecificDailyHours(plan.date, settings);

    // Keep one-sitting tasks and manual schedules, extract others for rebalancing if needed
    const currentTotal = plan.plannedTasks.reduce((sum, s) => sum + s.allocatedHours, 0);
    const remainingIfKeepAll = Math.max(0, dayCapacity - currentTotal);

    if (remainingIfKeepAll >= 1) {
      // Enough room left; don't strip sessions from this day
      return plan;
    }

    const sessionsToKeep = plan.plannedTasks.filter(session => {
      const task = tasks.find(t => t.id === session.taskId);

      // Keep one-sitting tasks
      if (task?.isOneTimeTask) {
        return true;
      }

      // Keep manually scheduled sessions
      if ((session as any).manuallyScheduled) {
        return true;
      }

      // Keep completed/skipped sessions
      if (session.done || session.status === 'completed' || session.status === 'skipped') {
        return true;
      }

      // Extract regular sessions for rebalancing
      if (task) {
        sessionsToRebalance.push({
          session: { ...session },
          task,
          originalDate: plan.date
        });
      }

      return false;
    });

    // Recalculate total hours for the day
    const totalHours = sessionsToKeep.reduce((sum, session) => sum + session.allocatedHours, 0);

    return {
      ...plan,
      plannedTasks: sessionsToKeep,
      totalStudyHours: Math.round(totalHours * 60) / 60
    };
  });

  // Step 3: Calculate daily capacity across all days
  const dailyCapacity = new Map<string, number>();
  for (const plan of rebalancedPlans) {
    const remainingCapacity = getDaySpecificDailyHours(plan.date, settings) - plan.totalStudyHours;
    dailyCapacity.set(plan.date, Math.max(0, remainingCapacity));
  }

  // Step 4: Redistribute extracted sessions using intelligent balancing
  return redistributeSessionsForBalance(
    rebalancedPlans,
    sessionsToRebalance,
    dailyCapacity,
    tasks,
    settings,
    fixedCommitments
  );
};

/**
 * Applies final workload smoothing to minimize daily variation in study hours
 */
const applyWorkloadSmoothing = (
  studyPlans: StudyPlan[],
  tasks: Task[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[]
): StudyPlan[] => {
  // Calculate current workload distribution
  const dailyWorkloads = new Map<string, number>();
  const movableSessions = new Map<string, StudySession[]>();

  // Track which days contain any one-sitting task
  const daysWithOneSitting = new Set<string>();

  for (const plan of studyPlans) {
    dailyWorkloads.set(plan.date, plan.totalStudyHours);

    // Mark days that contain one-sitting tasks
    if (plan.plannedTasks.some(s => {
      const t = tasks.find(tt => tt.id === s.taskId);
      return t?.isOneTimeTask;
    })) {
      daysWithOneSitting.add(plan.date);
    }

    // Identify sessions that can be moved (non-one-sitting, non-manual, non-completed)
    const movable = plan.plannedTasks.filter(session => {
      const task = tasks.find(t => t.id === session.taskId);
      return task &&
        !task.isOneTimeTask &&
        !session.manuallyScheduled &&
        !session.done &&
        session.status !== 'completed' &&
        session.status !== 'skipped';
    });

    movableSessions.set(plan.date, movable);
  }

  // Calculate workload statistics
  const workloads = Array.from(dailyWorkloads.values());
  const avgWorkload = workloads.reduce((a, b) => a + b, 0) / workloads.length;
  const maxWorkload = Math.max(...workloads);
  const minWorkload = Math.min(...workloads);
  const workloadVariation = maxWorkload - minWorkload;

  // If variation is reasonable, no smoothing needed
  if (workloadVariation <= 2) {
    return studyPlans;
  }

  // Identify overloaded and underloaded days
  const overloadThreshold = avgWorkload + (workloadVariation * 0.3);
  const underloadThreshold = avgWorkload - (workloadVariation * 0.3);

  // Exclude days that contain one-sitting tasks from being sources or targets
  const overloadedDays = Array.from(dailyWorkloads.entries())
    .filter(([date, workload]) => workload > overloadThreshold && !daysWithOneSitting.has(date))
    .sort(([, a], [, b]) => b - a); // Most overloaded first

  const underloadedDays = Array.from(dailyWorkloads.entries())
    .filter(([date, workload]) => workload < underloadThreshold && !daysWithOneSitting.has(date))
    .sort(([, a], [, b]) => a - b); // Least loaded first

  // Move sessions from overloaded to underloaded days
  const result = [...studyPlans];
  const minSessionLength = (settings.minSessionLength || 15) / 60;

  for (const [overloadedDate, overloadedWorkload] of overloadedDays) {
    const sessionsToMove = movableSessions.get(overloadedDate) || [];
    if (sessionsToMove.length === 0) continue;

    // Sort sessions by size (smallest first for easier redistribution)
    sessionsToMove.sort((a, b) => a.allocatedHours - b.allocatedHours);

    for (const session of sessionsToMove) {
      const task = tasks.find(t => t.id === session.taskId);
      if (!task) continue;

      // Find a suitable underloaded day for this session
      const suitableDay = findSuitableUnderloadedDay(
        session,
        task,
        underloadedDays,
        dailyWorkloads,
        settings,
        avgWorkload
      );

      if (suitableDay) {
        // Move the session
        moveSessionBetweenPlans(result, session, overloadedDate, suitableDay);

        // Update workload tracking
        dailyWorkloads.set(overloadedDate, dailyWorkloads.get(overloadedDate)! - session.allocatedHours);
        dailyWorkloads.set(suitableDay, dailyWorkloads.get(suitableDay)! + session.allocatedHours);

        // Check if this day is no longer significantly overloaded
        if (dailyWorkloads.get(overloadedDate)! <= avgWorkload + 1) {
          break;
        }
      }
    }
  }

  return result;
};

/**
 * Finds a suitable underloaded day for moving a session
 */
const findSuitableUnderloadedDay = (
  session: StudySession,
  task: Task,
  underloadedDays: [string, number][],
  dailyWorkloads: Map<string, number>,
  settings: UserSettings,
  avgWorkload: number
): string | null => {
  for (const [underloadedDate, currentWorkload] of underloadedDays) {
    // Check if this day is within the task's valid date range
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const startDate = task.startDate ? new Date(task.startDate) : today;
    const startDateStr = startDate > today ? task.startDate! : todayStr;

    if (underloadedDate < startDateStr) continue;

    if (task.deadline && task.deadlineType !== 'none') {
      const deadline = new Date(task.deadline);
      if (settings.bufferDays > 0) {
        deadline.setDate(deadline.getDate() - settings.bufferDays);
      }
      const deadlineStr = deadline.toISOString().split('T')[0];
      if (underloadedDate > deadlineStr) continue;
    }

    // Check if adding this session would create a reasonable workload
    const newWorkload = currentWorkload + session.allocatedHours;
    if (newWorkload <= avgWorkload + 1 && newWorkload <= getDaySpecificDailyHours(underloadedDate, settings)) {
      return underloadedDate;
    }
  }

  return null;
};

/**
 * Moves a session from one day to another in the study plans
 */
const moveSessionBetweenPlans = (
  studyPlans: StudyPlan[],
  session: StudySession,
  fromDate: string,
  toDate: string
): void => {
  const fromPlan = studyPlans.find(p => p.date === fromDate);
  const toPlan = studyPlans.find(p => p.date === toDate);

  if (!fromPlan || !toPlan) return;

  // Remove from source plan
  const sessionIndex = fromPlan.plannedTasks.findIndex(s =>
    s.taskId === session.taskId &&
    s.sessionNumber === session.sessionNumber &&
    s.allocatedHours === session.allocatedHours
  );

  if (sessionIndex !== -1) {
    fromPlan.plannedTasks.splice(sessionIndex, 1);
    fromPlan.totalStudyHours = Math.round((fromPlan.totalStudyHours - session.allocatedHours) * 60) / 60;

    // Add to destination plan
    toPlan.plannedTasks.push({
      ...session,
      scheduledTime: toDate,
      startTime: '',
      endTime: '',
      isFlexible: true,
      status: 'scheduled'
    });
    toPlan.totalStudyHours = Math.round((toPlan.totalStudyHours + session.allocatedHours) * 60) / 60;
  }
};

/**
 * Redistributes sessions to create balanced daily workloads
 */
const redistributeSessionsForBalance = (
  studyPlans: StudyPlan[],
  sessionsToRebalance: Array<{ session: StudySession; task: Task; originalDate: string }>,
  dailyCapacity: Map<string, number>,
  tasks: Task[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[]
): StudyPlan[] => {
  if (sessionsToRebalance.length === 0) {
    return studyPlans;
  }

  // Sort sessions by priority (importance + deadline urgency)
  sessionsToRebalance.sort((a, b) => {
    const aDaysUntilDeadline = a.task.deadline ?
      (new Date(a.task.deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) : 9999;
    const bDaysUntilDeadline = b.task.deadline ?
      (new Date(b.task.deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24) : 9999;

    const aPriority = a.task.importance ? 1 : 2;
    const bPriority = b.task.importance ? 1 : 2;

    if (aPriority !== bPriority) return aPriority - bPriority;
    return aDaysUntilDeadline - bDaysUntilDeadline;
  });

  const minSessionLength = (settings.minSessionLength || 15) / 60;
  const result = [...studyPlans];

  // Redistribute each session to the day with most available capacity (within deadline constraints)
  for (const { session, task } of sessionsToRebalance) {
    // Find valid days for this task
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const startDate = task.startDate ? new Date(task.startDate) : today;
    const startDateStr = startDate > today ? task.startDate! : todayStr;

    let validDays = Array.from(dailyCapacity.keys()).filter(date => date >= startDateStr);

    if (task.deadline && task.deadlineType !== 'none') {
      const deadline = new Date(task.deadline);
      if (settings.bufferDays > 0) {
        deadline.setDate(deadline.getDate() - settings.bufferDays);
      }
      const deadlineStr = deadline.toISOString().split('T')[0];
      validDays = validDays.filter(date => date <= deadlineStr);
    }

    // Find the day with most available capacity that can fit this session
    let bestDay: string | null = null;
    let bestCapacity = 0;

    for (const date of validDays) {
      const capacity = dailyCapacity.get(date) || 0;
      if (capacity >= session.allocatedHours && capacity >= minSessionLength && capacity > bestCapacity) {
        bestDay = date;
        bestCapacity = capacity;
      }
    }

    // Schedule the session on the best day
    if (bestDay) {
      const planIndex = result.findIndex(p => p.date === bestDay);
      if (planIndex !== -1) {
        result[planIndex].plannedTasks.push({
          ...session,
          scheduledTime: bestDay,
          startTime: '',
          endTime: '',
          isFlexible: true,
          status: 'scheduled'
        });

        result[planIndex].totalStudyHours = Math.round((result[planIndex].totalStudyHours + session.allocatedHours) * 60) / 60;
        dailyCapacity.set(bestDay, Math.round((bestCapacity - session.allocatedHours) * 60) / 60);
      }
    }
  }

  return result;
};

export const generateNewStudyPlanWithPreservation = (
  tasks: Task[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[],
  existingStudyPlans: StudyPlan[] = []
): { plans: StudyPlan[]; suggestions: Array<{ taskTitle: string; unscheduledMinutes: number }> } => {
  // First, generate the new study plan
  const existingWithFixed = markPastSessionsAsSkipped(existingStudyPlans);
  const result = generateNewStudyPlan(tasks, settings, fixedCommitments, existingWithFixed);

  // Apply manual schedule preservation (includes fixed sessions)
  const preservedPlans = preserveManualSchedules(result.plans, existingWithFixed, { preserveManualReschedules: true });

  // Skip special rebalancing around one-sitting tasks to avoid evicting other sessions
  const balancedPlans = preservedPlans;

  // Apply final workload smoothing (won't move sessions from days with one-sitting tasks)
  const smoothedPlans = applyWorkloadSmoothing(balancedPlans, tasks, settings, fixedCommitments);

  // FINAL SAFETY PASS: ensure all previously completed/skipped sessions are preserved exactly as-is
  const finalPlans = preserveFixedSessionsPostProcessing(smoothedPlans, existingStudyPlans);

  return {
    plans: finalPlans,
    suggestions: result.suggestions
  };
};

// Generate a new plan but only preserve completed/skipped sessions from previous plans
export const generateNewStudyPlanPreservingFixedOnly = (
  tasks: Task[],
  settings: UserSettings,
  fixedCommitments: FixedCommitment[],
  existingStudyPlans: StudyPlan[] = []
): { plans: StudyPlan[]; suggestions: Array<{ taskTitle: string; unscheduledMinutes: number }> } => {
  const existingWithFixed = markPastSessionsAsSkipped(existingStudyPlans);
  const result = generateNewStudyPlan(tasks, settings, fixedCommitments, existingWithFixed);
  const preservedFixedOnly = preserveManualSchedules(result.plans, existingWithFixed, { preserveManualReschedules: false });
  const balancedPlans = preservedFixedOnly; // do not rebalance around one-sitting tasks
  const smoothedPlans = applyWorkloadSmoothing(balancedPlans, tasks, settings, fixedCommitments);
  const finalPlans = preserveFixedSessionsPostProcessing(smoothedPlans, existingWithFixed);
  return { plans: finalPlans, suggestions: result.suggestions };
};
