export interface Task {
  id: string;
  title: string;
  description: string;
  deadline: string;
  importance: boolean; // true = Important, false = Not Important
  estimatedHours: number;
  status: 'pending' | 'in_progress' | 'completed';
  createdAt: string;
  subject?: string; // Optional for backward compatibility, can be removed if not used elsewhere
  category?: string;
  impact?: string;
  taskType?: string;
  // New properties for deadline flexibility
  deadlineType?: 'hard' | 'soft' | 'none'; // Type of deadline
  schedulingPreference?: 'consistent' | 'opportunistic' | 'intensive'; // How to schedule no-deadline tasks
  // Session-based estimation properties
  sessionDuration?: number; // Preferred session duration in hours
  totalTimeNeeded?: number; // Total time needed for the task (alternative to estimatedHours)
  preferredTimeSlots?: ('morning' | 'afternoon' | 'evening')[]; // Preferred time slots
  minWorkBlock?: number; // Minimum meaningful work session in minutes (only for deadline tasks)
  maxSessionLength?: number; // Maximum session length in hours (for no-deadline tasks or as general preference)
  isOneTimeTask?: boolean; // Task should be completed in one sitting, not divided into sessions
  startDate?: string; // New: earliest date the task can be scheduled (YYYY-MM-DD)
  targetFrequency?: 'daily' | '3x-week' | 'weekly' | 'flexible'; // Preferred scheduling frequency
  respectFrequencyForDeadlines?: boolean; // Whether to respect frequency even for deadline tasks
}

export interface SessionSchedulingMetadata {
  originalSlot?: {
    date: string;
    startTime: string;
    endTime: string;
  };
  rescheduleHistory: Array<{
    from: { date: string; startTime: string; endTime: string };
    to: { date: string; startTime: string; endTime: string };
    timestamp: string;
    reason: 'missed' | 'manual' | 'conflict' | 'redistribution' | 'unified_redistribution';
    success?: boolean;
  }>;
  redistributionRound?: number;
  priority?: number; // Calculated priority for redistribution
  // Enhanced metadata for unified redistribution
  failureReasons?: string[];
  successfulMoves?: number;
  lastProcessedAt?: string;
  state?: 'scheduled' | 'in_progress' | 'completed' | 'missed_original' | 'redistributed' | 'failed_redistribution' | 'skipped_user' | 'skipped_system';
}

export interface SkipMetadata {
  skippedAt: string;
  reason?: 'user_choice' | 'conflict' | 'overload';
  partialHours?: number; // For partial skipping
}

export interface StudySession {
  taskId: string;
  scheduledTime: string; // Keep for display purposes
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  allocatedHours: number;
  sessionNumber?: number; // For tracking multiple sessions of same task
  isFlexible?: boolean; // Can this session be moved around?
  isManualOverride?: boolean; // New property: true if manually edited
  done?: boolean; // New: true if session is marked as done
  status?: 'scheduled' | 'in_progress' | 'completed' | 'skipped'; // Simplified session states - forward focus approach
  actualHours?: number; // New: actual hours spent (may differ from allocatedHours)
  completedAt?: string; // New: timestamp when session was completed
  // Enhanced rescheduling metadata
  schedulingMetadata?: SessionSchedulingMetadata;
  skipMetadata?: SkipMetadata;
  // Legacy properties for backward compatibility
  originalTime?: string; // Original start time (HH:MM format)
  originalDate?: string; // Original date (YYYY-MM-DD format)
  rescheduledAt?: string; // Timestamp when session was rescheduled
  isAllDay?: boolean; // Whether this is an all-day session
}

/**
 * IMPORTANT: Skipped sessions should be handled consistently across the application:
 *
 * 1. Skipped sessions should NOT be included in:
 *    - Active session lists (StudyPlanView, Calendar)
 *    - Session combination logic
 *    - RAF timer loops or active scheduling
 *
 * 2. Skipped sessions SHOULD be included in:
 *    - Task progress calculations (reduces remaining estimated hours)
 *    - Study plan regeneration scheduling totals (prevents redistribution)
 *    - Study plan data structure (for audit trail and consistency)
 *    - Session numbering (to maintain consistency)
 *
 * 3. Skipped sessions are hidden from:
 *    - Calendar display (display: 'none')
 *    - Today's active session lists
 *
 * 4. Use utility functions from scheduling.ts:
 *    - calculateTotalStudyHours() - includes completed AND skipped sessions
 *    - filterSkippedSessions() - for filtering out skipped sessions from UI
 */
export interface StudyPlan {
  id: string;
  date: string;
  plannedTasks: StudySession[];
  totalStudyHours: number;
  availableHours: number; // How much time is actually available this day
  isOverloaded?: boolean; // Is this day too packed?
}

export interface Habit {
  id: string;
  title: string;
  cadence: 'daily' | 'weekly';
  targetPerWeek?: number; // for weekly cadence
  reminder?: boolean;
  streak: number;
  lastDoneDate?: string; // YYYY-MM-DD
  history: string[]; // dates done (YYYY-MM-DD)
  createdAt: string;
}

export interface DateSpecificStudyWindow {
  date: string; // YYYY-MM-DD format
  startHour: number; // 0-23
  endHour: number; // 0-23
  isActive: boolean; // Whether this override is active
}

export interface DaySpecificStudyWindow {
  dayOfWeek: number; // 0=Sunday, 1=Monday, 2=Tuesday, etc.
  startHour: number; // 0-23
  endHour: number; // 0-23
  isActive: boolean; // Whether this override is active
}

export interface DaySpecificStudyHours {
  dayOfWeek: number; // 0=Sunday, 1=Monday, 2=Tuesday, etc.
  studyHours: number; // Hours available for study on this day
  isActive: boolean; // Whether this override is active
}

export interface UserSettings {
  dailyAvailableHours: number;
  workDays: number[]; // Days of week user wants to work (0=Sunday, 1=Monday, etc.)
  bufferDays: number; // How many days before deadline to finish tasks
  minSessionLength: number; // Minimum session length in minutes, default 15
  // New settings
  bufferTimeBetweenSessions: number; // Minutes of buffer between sessions
  shortBreakDuration: number; // Minutes for short breaks
  longBreakDuration: number; // Minutes for long breaks
  maxConsecutiveHours: number; // Maximum hours before requiring a long break
  studyWindowStartHour: number; // Earliest hour to start studying (0-23) - default/fallback
  studyWindowEndHour: number; // Latest hour to end studying (0-23) - default/fallback
  avoidTimeRanges: Array<{start: string, end: string}>; // Time ranges to avoid scheduling
  weekendStudyHours: number; // Hours available for weekend study
  autoCompleteSessions: boolean; // Auto-mark sessions as complete after timer
  enableNotifications: boolean; // Enable study reminders and notifications
  userPrefersPressure?: boolean; // User prefers pressure mode for scheduling
  studyStyle?: 'steady' | 'pressure'; // Study style preference
  studyPlanMode?: 'eisenhower' | 'even' | 'balanced';
  // Date-specific study windows (optional)
  dateSpecificStudyWindows?: DateSpecificStudyWindow[]; // Override study windows for specific dates
  // Day-specific study windows (optional)
  daySpecificStudyWindows?: DaySpecificStudyWindow[]; // Override study windows for specific days of the week
  // Day-specific study hours (optional)
  daySpecificStudyHours?: DaySpecificStudyHours[]; // Override daily study hours for specific days of the week
  // UI preference for showing day-specific hours section
  showDaySpecificHoursSection?: boolean; // Whether to show the day-specific hours section in settings
}

export interface TimerState {
  isRunning: boolean;
  currentTime: number;
  totalTime: number;
  currentTaskId: string | null;
  startTime?: number; // High-resolution timestamp when timer started
  pausedTime?: number; // Accumulated paused time in seconds
  lastUpdateTime?: number; // Last time the timer was updated
}

export interface TimeRange {
  start: string; // HH:MM format
  end: string; // HH:MM format
}

export interface GeneratedSession {
  date: string; // YYYY-MM-DD format
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  duration: number; // Duration in hours
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
}


export interface DaySpecificTiming {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  isAllDay?: boolean; // Whether this day is all-day
}

export interface FixedCommitment {
  id: string;
  title: string;
  type?: 'fixed'; // Add type to distinguish from smart commitments
  startTime?: string; // HH:MM format - optional for all-day events (used when useDaySpecificTiming is false)
  endTime?: string; // HH:MM format - optional for all-day events (used when useDaySpecificTiming is false)
  recurring: boolean; // true for recurring, false for one-time
  daysOfWeek: number[]; // 0 = Sunday, 1 = Monday, etc. (for recurring commitments)
  specificDates?: string[]; // Array of date strings (YYYY-MM-DD) for non-recurring commitments
  category: string; // Using the same categories as tasks
  location?: string;
  description?: string;
  createdAt: string;
  isAllDay?: boolean; // New field for all-day events with no specific time (used when useDaySpecificTiming is false)
  dateRange?: { // New field for recurring commitments with date range
    startDate: string; // YYYY-MM-DD format
    endDate: string; // YYYY-MM-DD format
  };
  countsTowardDailyHours?: boolean; // Whether this commitment counts toward daily available hours
  // Day-specific timing configuration
  useDaySpecificTiming?: boolean; // Whether to use day-specific times instead of general startTime/endTime
  daySpecificTimings?: DaySpecificTiming[]; // Array of timing configurations for specific days
  // New fields for individual session management
  deletedOccurrences?: string[]; // Array of date strings (YYYY-MM-DD)
  modifiedOccurrences?: {
    [date: string]: {
      startTime?: string;
      endTime?: string;
      title?: string;
      category?: string; // Using the same categories as tasks
      isAllDay?: boolean; // Allow individual occurrences to be all-day
    };
  };
}

// Union type for all commitment types
export type Commitment = FixedCommitment;

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: {
    type: 'study' | 'commitment' | 'smart-commitment';
    data: StudySession | FixedCommitment | SmartCommitment;
    taskId?: string;
    planDate?: string; // For study sessions, which plan date they belong to
    commitmentType?: 'fixed' | 'smart'; // Additional field to distinguish commitment types
    isPattern?: boolean; // For smart commitments, indicates this is part of a recurring pattern
  };
}

export interface TaskProgress {
  taskId: string;
  completedHours: number;
  totalHours: number;
  sessionsCompleted: number;
  lastWorkedOn?: string; // Date string
}

export interface SmartSuggestion {
  type: 'warning' | 'suggestion' | 'celebration';
  message: string;
  action?: string;
  taskId?: string;
}

export interface TimeSlot {
  start: string; // HH:MM format
  end: string; // HH:MM format
  duration: number; // in hours
}

export interface ConflictCheckResult {
  isValid: boolean;
  conflicts: Array<{
    type: 'session_overlap' | 'commitment_conflict' | 'daily_limit_exceeded' | 'invalid_time_slot';
    message: string;
    conflictingItem?: StudySession | FixedCommitment;
  }>;
  suggestedAlternatives?: TimeSlot[];
}


export interface UserReschedule {
  id: string; // Unique identifier for this reschedule
  originalSessionId: string; // taskId-sessionNumber combination
  originalPlanDate: string; // Original date (YYYY-MM-DD)
  originalStartTime: string; // Original start time (HH:MM)
  originalEndTime: string; // Original end time (HH:MM)
  newPlanDate: string; // New date (YYYY-MM-DD)
  newStartTime: string; // New start time (HH:MM)
  newEndTime: string; // New end time (HH:MM)
  rescheduledAt: string; // Timestamp when rescheduled
  status: 'active' | 'obsolete'; // Whether this reschedule is still valid
  taskId: string; // Reference to the task
  sessionNumber?: number; // Session number for tracking
}
