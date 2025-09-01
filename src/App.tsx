import React, { useState, useEffect, useRef } from 'react';
import { Calendar, CheckSquare, Clock, Settings as SettingsIcon, BarChart3, CalendarDays, Lightbulb, Edit, Trash2, Menu, X, HelpCircle, Trophy, User } from 'lucide-react';
import { Task, StudyPlan, UserSettings, FixedCommitment, Commitment, StudySession, TimerState, Habit } from './types';
import { GamificationData, Achievement, DailyChallenge, MotivationalMessage } from './types-gamification';
import { useRobustTimer, startTimer, pauseTimer, resumeTimer, resetTimer, updateTimerTime } from './hooks/useRobustTimer';
import { getUnscheduledMinutesForTasks, getLocalDateString, checkCommitmentConflicts, generateNewStudyPlan, generateNewStudyPlanWithPreservation, reshuffleStudyPlan, markPastSessionsAsSkipped, formatTime } from './utils/scheduling';
import { getAccurateUnscheduledTasks, shouldShowNotifications, getNotificationPriority } from './utils/enhanced-notifications';
import { enhancedEstimationTracker } from './utils/enhanced-estimation-tracker';
import {
  ACHIEVEMENTS,
  updateUserStats,
  checkAchievementUnlocks,
  generateDailyChallenge,
  getMotivationalMessage,
  updateStudyStreak,
  calculateLevel
} from './utils/gamification';

import Dashboard from './components/Dashboard';
import TaskInput from './components/TaskInputSimplified';
import TaskList from './components/TaskList';
import StudyPlanView from './components/StudyPlanView';
import StudyTimer from './components/StudyTimer';
import Settings from './components/Settings';
import CalendarView from './components/CalendarView';
import FixedCommitmentInput from './components/FixedCommitmentInput';
import FixedCommitmentEdit from './components/FixedCommitmentEdit';
import CommitmentsList from './components/CommitmentsList';
import GamificationPanel from './components/GamificationPanel';
import AchievementNotification, { MotivationalToast } from './components/AchievementNotification';
import SuggestionsPanel from './components/SuggestionsPanel';
import InteractiveTutorial from './components/InteractiveTutorial';
import TutorialButton from './components/TutorialButton';
import ErrorBoundary from './components/ErrorBoundary';
import TimePilotIcon from './components/TimePilotIcon';
import WelcomeOnboarding from './components/WelcomeOnboarding';
import GuidedTaskInput from './components/GuidedTaskInput';
import Confetti from './components/Confetti';
import PWAInstallPrompt from './components/PWAInstallPrompt';
import './utils/test-data-setup'; // Import test data setup for testing
import { assessAddTaskFeasibility } from './utils/task-feasibility';

function App() {
    // State initialization first
    const [activeTab, setActiveTab] = useState<'dashboard' | 'tasks' | 'plan' | 'timer' | 'calendar' | 'commitments' | 'settings'>('dashboard');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [studyPlans, setStudyPlans] = useState<StudyPlan[]>([]);
    const [currentTask, setCurrentTask] = useState<Task | null>(null);
    const [currentSession, setCurrentSession] = useState<{ allocatedHours: number; planDate?: string; sessionNumber?: number } | null>(null);
    const [fixedCommitments, setFixedCommitments] = useState<FixedCommitment[]>([]);
    const [settings, setSettings] = useState<UserSettings>({
        dailyAvailableHours: 6,
        workDays: [0, 1, 2, 3, 4, 5, 6],
        bufferDays: 0,
        minSessionLength: 15,
        bufferTimeBetweenSessions: 0,
        studyWindowStartHour: 6,
        studyWindowEndHour: 23,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        maxConsecutiveHours: 4,
        avoidTimeRanges: [],
        weekendStudyHours: 4,
        autoCompleteSessions: false,
        enableNotifications: true,
        userPrefersPressure: false,
        studyPlanMode: 'even',
        dateSpecificStudyWindows: [],
        daySpecificStudyWindows: [],
        daySpecificStudyHours: [],
        showDaySpecificHoursSection: false
    });
    const [, setIsPlanStale] = useState(false);
    const [, setLastPlanStaleReason] = useState<"settings" | "commitment" | "task" | null>(null);
    const [hasLoadedFromStorage, setHasLoadedFromStorage] = useState(false);
    const [hasFirstChangeOccurred, setHasFirstChangeOccurred] = useState(false);
    const hasProcessedPastSessions = useRef(false);

    // Add state to track last-timed session and ready-to-mark-done
    const [lastTimedSession, setLastTimedSession] = useState<{ planDate: string; sessionNumber: number } | null>(null);
    const [editingCommitment, setEditingCommitment] = useState<FixedCommitment | null>(null);

    // Global timer state that persists across tab switches
    const [globalTimer, setGlobalTimer] = useState<TimerState>({
        isRunning: false,
        currentTime: 0,
        totalTime: 0,
        currentTaskId: null,
        startTime: undefined,
        pausedTime: undefined,
        lastUpdateTime: undefined
    });

    const [showTaskInput, setShowTaskInput] = useState(false);
    const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
    const [autoRemovedTasks, setAutoRemovedTasks] = useState<string[]>([]);
    const [showSuggestionsPanel, setShowSuggestionsPanel] = useState(false);

    // Habits state
    const [habits, setHabits] = useState<Habit[]>([]);

    // State to track if current timer is for a commitment
    const [currentCommitment, setCurrentCommitment] = useState<FixedCommitment | null>(null);

    // State to track completed commitments for history/analytics
    const [completedCommitments, setCompletedCommitments] = useState<Array<{
        commitmentId: string;
        title: string;
        date: string;
        duration: number;
        actualHours: number;
        completedAt: string;
    }>>([]);

    // Onboarding tutorial state
    const [showInteractiveTutorial, setShowInteractiveTutorial] = useState(false);
    const [highlightedTab, setHighlightedTab] = useState<string | null>(null);
    const [highlightStudyPlanMode, setHighlightStudyPlanMode] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [showGCashModal, setShowGCashModal] = useState(false);

    // Gamification state
    const [showGamificationPanel, setShowGamificationPanel] = useState(false);
    const [gamificationData, setGamificationData] = useState<GamificationData>({
        achievements: ACHIEVEMENTS,
        unlockedAchievements: [],
        stats: {
            totalStudyHours: 0,
            totalTasksCompleted: 0,
            currentStreak: 0,
            longestStreak: 0,
            perfectWeeks: 0,
            earlyFinishes: 0,
            totalSessions: 0,
            averageSessionLength: 0,
            favoriteStudyTime: 'morning' as const,
            efficiencyScore: 100,
            level: 1,
            totalPoints: 0,
            joinedDate: new Date().toISOString(),
            lastActiveDate: new Date().toISOString()
        },
        streak: {
            current: 0,
            longest: 0,
            lastStudyDate: '',
            streakDates: []
        },
        milestones: [],
        level: calculateLevel(0),
        recentUnlocks: []
    });
    const [achievementNotification, setAchievementNotification] = useState<Achievement | null>(null);
    const [motivationalToast, setMotivationalToast] = useState<{
        message: string;
        icon: string;
        type: 'encouragement' | 'celebration' | 'tip' | 'reminder';
    } | null>(null);

    // Dark mode state
    const [darkMode, setDarkMode] = useState(false);

    // Onboarding state
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showGuidedInput, setShowGuidedInput] = useState(false);
    const [isFirstTimeUser, setIsFirstTimeUser] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);

    // Load data from localStorage after component mounts
    useEffect(() => {
        try {
            // Load tasks
            const savedTasks = localStorage.getItem('timepilot-tasks');
            if (savedTasks) {
                const parsed = JSON.parse(savedTasks);
                if (Array.isArray(parsed)) {
                    setTasks(parsed);
                }
            }

            // Load study plans
            const savedStudyPlans = localStorage.getItem('timepilot-studyPlans');
            if (savedStudyPlans) {
                const parsed = JSON.parse(savedStudyPlans);
                if (Array.isArray(parsed)) {
                    setStudyPlans(parsed);
                }
            }

            // Load fixed commitments
            const savedCommitments = localStorage.getItem('timepilot-commitments');
            if (savedCommitments) {
                const parsed = JSON.parse(savedCommitments);
                if (Array.isArray(parsed)) {
                    // Migrate existing commitments to include recurring field
                    const migratedCommitments = parsed.map((commitment: any) => {
                        if (commitment.recurring === undefined) {
                            return {
                                ...commitment,
                                recurring: true,
                                specificDates: commitment.specificDates || []
                            };
                        }
                        return commitment;
                    });
                    setFixedCommitments(migratedCommitments);
                }
            }

            // Load settings
            const savedSettings = localStorage.getItem('timepilot-settings');
            if (savedSettings) {
                const parsed = JSON.parse(savedSettings);
                if (parsed && typeof parsed === 'object') {
                    const defaultSettings = {
                        dailyAvailableHours: 6,
                        workDays: [0, 1, 2, 3, 4, 5, 6],
                        bufferDays: 0,
                        minSessionLength: 15,
                        bufferTimeBetweenSessions: 0,
                        studyWindowStartHour: 6,
                        studyWindowEndHour: 23,
                        shortBreakDuration: 5,
                        longBreakDuration: 15,
                        maxConsecutiveHours: 4,
                        avoidTimeRanges: [],
                        weekendStudyHours: 4,
                        autoCompleteSessions: false,
                        enableNotifications: true,
                        userPrefersPressure: false,
                        studyPlanMode: 'even',
                        dateSpecificStudyWindows: [],
                        daySpecificStudyWindows: [],
                        daySpecificStudyHours: [],
                        showDaySpecificHoursSection: false
                    };
                    setSettings({ ...defaultSettings, ...parsed });
                }
            }

            // Load habits
            const savedHabits = localStorage.getItem('timepilot-habits');
            if (savedHabits) {
                try {
                    const parsed = JSON.parse(savedHabits);
                    if (Array.isArray(parsed)) setHabits(parsed);
                } catch {}
            }

            // Load gamification data
            const savedGamification = localStorage.getItem('timepilot-gamification');
            if (savedGamification) {
                const parsed = JSON.parse(savedGamification);
                setGamificationData(parsed);
            }

            // Load dark mode
            const savedDarkMode = localStorage.getItem('timepilot-darkmode');
            if (savedDarkMode) {
                const parsed = JSON.parse(savedDarkMode);
                setDarkMode(parsed);
            }

            // Clean up localStorage keys from removed missed sessions feature
            localStorage.removeItem('timepilot-showMissedSessions');

            // Check if this is a first-time user (no onboarding completion flag)
            const hasCompletedOnboarding = localStorage.getItem('timepilot-onboarding-completed');
            const hasAnyData = savedTasks || savedStudyPlans || savedCommitments;

            if (!hasCompletedOnboarding && !hasAnyData) {
                setIsFirstTimeUser(true);
                setShowOnboarding(true);
            }

            setHasLoadedFromStorage(true);
        } catch (error) {
            console.error('Error loading data from localStorage:', error);
            setHasLoadedFromStorage(true);
        }
    }, []);

    // Persist gamification data
    useEffect(() => {
        localStorage.setItem('timepilot-gamification', JSON.stringify(gamificationData));
    }, [gamificationData]);

    // Persist dark mode
    useEffect(() => {
        localStorage.setItem('timepilot-darkmode', JSON.stringify(darkMode));
        // Apply dark mode to document
        if (darkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        // Update theme-color to match mode (for mobile status bar)
        const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
        if (meta) {
            meta.setAttribute('content', darkMode ? '#0b1020' : '#3b82f6');
        }
    }, [darkMode]);

    // Check for past sessions and automatically mark them as skipped (run once after initial load)
    useEffect(() => {
        // Only run this check after data has been loaded from storage and we have plans
        if (!hasLoadedFromStorage || studyPlans.length === 0 || hasProcessedPastSessions.current) return;

        // Mark past incomplete sessions as skipped
        const updatedPlans = markPastSessionsAsSkipped(studyPlans);

        // Check if any sessions were actually updated
        const hasChanges = JSON.stringify(updatedPlans) !== JSON.stringify(studyPlans);

        if (hasChanges) {
            setStudyPlans(updatedPlans);

            // Count how many sessions were automatically skipped
            let skippedCount = 0;
            updatedPlans.forEach(plan => {
                plan.plannedTasks.forEach(session => {
                    if (session.status === 'skipped' &&
                        session.skipMetadata?.reason === 'overload' &&
                        session.skipMetadata?.skippedAt) {
                        const skippedDate = new Date(session.skipMetadata.skippedAt);
                        const now = new Date();
                        // Only count if skipped recently (within last 5 minutes to avoid counting old ones)
                        if (now.getTime() - skippedDate.getTime() < 5 * 60 * 1000) {
                            skippedCount++;
                        }
                    }
                });
            });

            // Show notification if sessions were automatically skipped
            if (skippedCount > 0) {
                setNotificationMessage(
                    `📅 ${skippedCount} past incomplete session${skippedCount > 1 ? 's' : ''} ${skippedCount > 1 ? 'were' : 'was'} automatically marked as skipped. They will not be rescheduled.`
                );
                setTimeout(() => setNotificationMessage(null), 6000);
            }
        }

        // Mark that we've processed past sessions to avoid running again
        hasProcessedPastSessions.current = true;
    }, [hasLoadedFromStorage, studyPlans]);

    // Daily check for past sessions - runs when app loads and date has changed
    useEffect(() => {
        if (!hasLoadedFromStorage) return;

        const lastCheckDate = localStorage.getItem('timepilot-last-past-session-check');
        const today = getLocalDateString();

        // If we haven't checked today, or this is the first time
        if (lastCheckDate !== today && studyPlans.length > 0) {
            // Mark past incomplete sessions as skipped
            const updatedPlans = markPastSessionsAsSkipped(studyPlans);

            // Check if any sessions were actually updated
            const hasChanges = JSON.stringify(updatedPlans) !== JSON.stringify(studyPlans);

            if (hasChanges) {
                setStudyPlans(updatedPlans);
            }

            // Update the last check date
            localStorage.setItem('timepilot-last-past-session-check', today);
        }
    }, [hasLoadedFromStorage]); // Run when app loads

    // Periodic check for date changes (every minute) to handle day transitions
    useEffect(() => {
        if (!hasLoadedFromStorage) return;

        const interval = setInterval(() => {
            const lastCheckDate = localStorage.getItem('timepilot-last-past-session-check');
            const today = getLocalDateString();

            // If date has changed and we have study plans, run the skip check
            if (lastCheckDate !== today && studyPlans.length > 0) {
                const updatedPlans = markPastSessionsAsSkipped(studyPlans);
                const hasChanges = JSON.stringify(updatedPlans) !== JSON.stringify(studyPlans);

                if (hasChanges) {
                    setStudyPlans(updatedPlans);
                    console.log('Automatically skipped past sessions due to date change');
                }

                localStorage.setItem('timepilot-last-past-session-check', today);
            }
        }, 60000); // Check every minute

        return () => clearInterval(interval);
    }, [hasLoadedFromStorage, studyPlans]);

    // Update gamification when study data changes
    const updateGamificationData = (updatedStudyPlans?: StudyPlan[], updatedTasks?: Task[]) => {
        const plansToUse = updatedStudyPlans || studyPlans;
        const tasksToUse = updatedTasks || tasks;

        // Update stats
        const updatedStats = updateUserStats(gamificationData.stats, plansToUse, tasksToUse);

        // Update streak
        const updatedStreak = updateStudyStreak(gamificationData.streak, plansToUse);

        // Check for new achievements
        const newUnlocks = checkAchievementUnlocks(
            gamificationData.unlockedAchievements,
            updatedStats,
            updatedStreak
        );

        // Update level
        const totalPoints = updatedStats.totalPoints + newUnlocks.reduce((sum, id) => {
            const achievement = ACHIEVEMENTS.find(a => a.id === id);
            return sum + (achievement?.points || 0);
        }, 0);

        const updatedLevel = calculateLevel(totalPoints);

        // Update gamification data
        const newGamificationData: GamificationData = {
            ...gamificationData,
            stats: { ...updatedStats, totalPoints },
            streak: updatedStreak,
            level: updatedLevel,
            unlockedAchievements: [...gamificationData.unlockedAchievements, ...newUnlocks],
            recentUnlocks: [...newUnlocks, ...gamificationData.recentUnlocks].slice(0, 5) // Keep last 5
        };

        // Generate daily challenge if needed
        if (!newGamificationData.dailyChallenge ||
            new Date(newGamificationData.dailyChallenge.expiresAt) < new Date()) {
            newGamificationData.dailyChallenge = generateDailyChallenge(updatedStats);
        }

        setGamificationData(newGamificationData);

        // Show achievement notifications
        if (newUnlocks.length > 0) {
            const firstUnlock = ACHIEVEMENTS.find(a => a.id === newUnlocks[0]);
            if (firstUnlock) {
                setAchievementNotification(firstUnlock);
            }
        }

        // Show motivational messages occasionally
        if (Math.random() < 0.3) { // 30% chance
            const message = getMotivationalMessage('study_complete', updatedStats);
            setMotivationalToast({
                message: message.message,
                icon: message.icon,
                type: message.type
            });
        }
    };

    // Simple tab tracking for analytics (if needed)
    const trackTabUsage = (tab: string) => {
        // Simple logging - can be extended for analytics if needed
        console.log(`Tab switched to: ${tab}`);
    };

    // Track tab changes
    useEffect(() => {
        trackTabUsage(activeTab);
    }, [activeTab]);



    // Persist user reschedules to localStorage
    useEffect(() => {
        // Removed userReschedules persistence
    }, []);

    // Apply user reschedules when the app loads (initial load only)
    useEffect(() => {
        // Removed user reschedules application
    }, [hasLoadedFromStorage, studyPlans]);

    // Use the robust timer hook instead of setInterval
    useRobustTimer({
        timer: globalTimer,
        onTimerUpdate: setGlobalTimer,
        taskTitle: currentTask?.title,
        onTimerComplete: () => {
            // Timer completed - stop it and keep at 0
            setGlobalTimer(prev => ({
                ...prev,
                currentTime: 0,
                isRunning: false,
                startTime: undefined,
                pausedTime: undefined,
                lastUpdateTime: undefined
            }));
        }
    });

    useEffect(() => {
        try {
            const savedTasks = localStorage.getItem('timepilot-tasks');
            const savedSettings = localStorage.getItem('timepilot-settings');
            const savedCommitments = localStorage.getItem('timepilot-commitments');
            const savedStudyPlans = localStorage.getItem('timepilot-studyPlans');

            // Prepare initial state
            let initialTasks: Task[] = [];
            let initialSettings: UserSettings = {
                dailyAvailableHours: 6,
                workDays: [1, 2, 3, 4, 5, 6],
                bufferDays: 0,
                minSessionLength: 15,
                bufferTimeBetweenSessions: 0,
                studyWindowStartHour: 6,
                studyWindowEndHour: 23,
                shortBreakDuration: 5,
                longBreakDuration: 15,
                maxConsecutiveHours: 4,
                avoidTimeRanges: [],
                weekendStudyHours: 4,
                autoCompleteSessions: false,
                enableNotifications: true,
                userPrefersPressure: false,
                studyPlanMode: 'even', // Set default to 'even'
                dateSpecificStudyWindows: [],
                daySpecificStudyWindows: [],
                daySpecificStudyHours: [],
                showDaySpecificHoursSection: false
            };
            let initialCommitments: FixedCommitment[] = [];
            let initialStudyPlans: StudyPlan[] = [];

            if (savedTasks) {
                const parsedTasks = JSON.parse(savedTasks);
                if (Array.isArray(parsedTasks)) initialTasks = parsedTasks;
            }

            if (savedSettings) {
                const parsedSettings = JSON.parse(savedSettings);
                if (parsedSettings && typeof parsedSettings === 'object') {
                    // Filter out removed settings
                    initialSettings = {
                        dailyAvailableHours: parsedSettings.dailyAvailableHours || 6,
                        workDays: parsedSettings.workDays || [0, 1, 2, 3, 4, 5, 6],
                        bufferDays: parsedSettings.bufferDays || 0,
                        minSessionLength: parsedSettings.minSessionLength || 15,
                        bufferTimeBetweenSessions: parsedSettings.bufferTimeBetweenSessions ?? 0,
                        studyWindowStartHour: parsedSettings.studyWindowStartHour || 6,
                        studyWindowEndHour: parsedSettings.studyWindowEndHour || 23,
                        shortBreakDuration: parsedSettings.shortBreakDuration || 5,
                        longBreakDuration: parsedSettings.longBreakDuration || 15,
                        maxConsecutiveHours: parsedSettings.maxConsecutiveHours || 4,
                        avoidTimeRanges: parsedSettings.avoidTimeRanges || [],
                        weekendStudyHours: parsedSettings.weekendStudyHours || 4,
                        autoCompleteSessions: parsedSettings.autoCompleteSessions || false,
                        enableNotifications: parsedSettings.enableNotifications !== false,
                        userPrefersPressure: parsedSettings.userPrefersPressure || false,
                        studyPlanMode: parsedSettings.studyPlanMode || 'even',
                        dateSpecificStudyWindows: parsedSettings.dateSpecificStudyWindows || [],
                        daySpecificStudyWindows: parsedSettings.daySpecificStudyWindows || [],
                        daySpecificStudyHours: parsedSettings.daySpecificStudyHours || [],
                        showDaySpecificHoursSection: parsedSettings.showDaySpecificHoursSection || false
                    };
                }
            }

            if (savedCommitments) {
                const parsedCommitments = JSON.parse(savedCommitments);
                if (Array.isArray(parsedCommitments)) initialCommitments = parsedCommitments;
            }

            // Load completed commitments history
            const savedCompletedCommitments = localStorage.getItem('timepilot-completed-commitments');
            let initialCompletedCommitments: Array<{
                commitmentId: string;
                title: string;
                date: string;
                duration: number;
                actualHours: number;
                completedAt: string;
            }> = [];
            if (savedCompletedCommitments) {
                try {
                    const parsed = JSON.parse(savedCompletedCommitments);
                    if (Array.isArray(parsed)) initialCompletedCommitments = parsed;
                } catch (error) {
                    console.warn('Failed to parse completed commitments from localStorage:', error);
                }
            }

            if (savedStudyPlans) {
                const parsedStudyPlans = JSON.parse(savedStudyPlans);
                if (Array.isArray(parsedStudyPlans)) initialStudyPlans = parsedStudyPlans;
            }

            // Set all state in one batch
            setTasks(initialTasks);
            setSettings(initialSettings);
            setFixedCommitments(initialCommitments);
            setStudyPlans(initialStudyPlans);
            setCompletedCommitments(initialCompletedCommitments);
            setIsPlanStale(false); // Mark plan as not stale on initial load
            setHasLoadedFromStorage(true); // Mark that initial load is complete
            setHasFirstChangeOccurred(false); // Reset first change flag
        } catch (e) {
            setTasks([]);
            setSettings({
                dailyAvailableHours: 6,
                workDays: [1, 2, 3, 4, 5, 6],
                bufferDays: 0,
                minSessionLength: 15,
                bufferTimeBetweenSessions: 0,
                studyWindowStartHour: 6,
                studyWindowEndHour: 23,
                shortBreakDuration: 5,
                longBreakDuration: 15,
                maxConsecutiveHours: 4,
                avoidTimeRanges: [],
                weekendStudyHours: 4,
                autoCompleteSessions: false,
                enableNotifications: true,
                userPrefersPressure: false,
                studyPlanMode: 'even', // Set default to 'even'
            });
            setFixedCommitments([]);
            setStudyPlans([]);
            setCompletedCommitments([]);
            setIsPlanStale(false); // Mark plan as not stale on initial load (even on error)
            setHasLoadedFromStorage(true); // Mark that initial load is complete
            setHasFirstChangeOccurred(false); // Reset first change flag
        }
    }, []);

    // Save data to localStorage whenever tasks or settings change
    useEffect(() => {
        localStorage.setItem('timepilot-tasks', JSON.stringify(tasks));
    }, [tasks]);

    useEffect(() => {
        localStorage.setItem('timepilot-settings', JSON.stringify(settings));
    }, [settings]);

    useEffect(() => {
        localStorage.setItem('timepilot-commitments', JSON.stringify(fixedCommitments));
    }, [fixedCommitments]);

    useEffect(() => {
        localStorage.setItem('timepilot-completed-commitments', JSON.stringify(completedCommitments));
    }, [completedCommitments]);


    useEffect(() => {
        localStorage.setItem('timepilot-studyPlans', JSON.stringify(studyPlans));
    }, [studyPlans]);

    useEffect(() => {
        localStorage.setItem('timepilot-habits', JSON.stringify(habits));
    }, [habits]);

    // Mark plan as stale when tasks, settings, or commitments change (but not on initial load)
    useEffect(() => {
        if (!hasLoadedFromStorage) return;
        if (!hasFirstChangeOccurred) {
            setHasFirstChangeOccurred(true);
            return;
        }
        // Only set isPlanStale if there are tasks and commitments
        if (tasks.length > 0 && fixedCommitments.length > 0) {
            setIsPlanStale(true);
        } else {
            setIsPlanStale(false);
        }
    }, [tasks, settings, fixedCommitments, hasLoadedFromStorage]);

    // Habit helpers
    const computeDailyStreak = (dates: Set<string>, todayStr: string) => {
        let streak = 0;
        const d = new Date(todayStr);
        while (true) {
            const yyyy = d.toISOString().split('T')[0];
            if (dates.has(yyyy)) {
                streak += 1;
                d.setDate(d.getDate() - 1);
            } else {
                break;
            }
        }
        return streak;
    };

    const computeWeeklyStreak = (history: string[], targetPerWeek: number = 1, todayStr: string) => {
        // Count consecutive weeks (ending this week) meeting target
        const byWeek = new Map<string, number>();
        history.forEach(d => {
            const date = new Date(d);
            const startOfWeek = new Date(date);
            startOfWeek.setDate(date.getDate() - date.getDay());
            const key = startOfWeek.toISOString().split('T')[0];
            byWeek.set(key, (byWeek.get(key) || 0) + 1);
        });
        let streak = 0;
        const now = new Date(todayStr);
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        while (true) {
            const key = weekStart.toISOString().split('T')[0];
            const count = byWeek.get(key) || 0;
            if (count >= targetPerWeek) {
                streak += 1;
                weekStart.setDate(weekStart.getDate() - 7);
            } else {
                break;
            }
        }
        return streak;
    };

    const handleAddHabit = (input: { title: string; cadence: 'daily' | 'weekly'; targetPerWeek?: number; reminder?: boolean }) => {
        const newHabit: Habit = {
            id: Date.now().toString(),
            title: input.title.trim(),
            cadence: input.cadence,
            targetPerWeek: input.cadence === 'weekly' ? (input.targetPerWeek || 1) : undefined,
            reminder: input.reminder,
            streak: 0,
            history: [],
            createdAt: new Date().toISOString(),
        };
        setHabits(prev => [...prev, newHabit]);
    };

    const handleToggleHabitToday = (habitId: string) => {
        const today = getLocalDateString();
        setHabits(prev => prev.map(h => {
            if (h.id !== habitId) return h;
            const hasToday = h.history.includes(today);
            const newHistory = hasToday ? h.history.filter(d => d !== today) : [...h.history, today];
            // Recompute streak
            const datesSet = new Set(newHistory);
            let streak = 0;
            if (h.cadence === 'daily') {
                streak = computeDailyStreak(datesSet, today);
            } else {
                streak = computeWeeklyStreak(newHistory, h.targetPerWeek || 1, today);
            }
            return { ...h, history: newHistory, lastDoneDate: hasToday ? undefined : today, streak };
        }));
    };

    const handleDeleteHabit = (habitId: string) => {
        setHabits(prev => prev.filter(h => h.id !== habitId));
    };

    // Manual study plan generation handler
    const handleGenerateStudyPlan = async () => {
        if (tasks.length > 0) {
            // Smart hour adjustment: Check if regenerating would create overwhelming schedules
            const today = getLocalDateString();
            const activeTasks = tasks.filter(task => task.status === 'pending' && task.estimatedHours > 0);
            const totalRemainingHours = activeTasks.reduce((sum, task) => sum + task.estimatedHours, 0);

            // Calculate available days until the earliest deadline
            const earliestDeadline = activeTasks.reduce((earliest, task) => {
                if (!task.deadline) return earliest;
                const taskDeadline = new Date(task.deadline);
                return !earliest || taskDeadline < earliest ? taskDeadline : earliest;
            }, null as Date | null);

            if (earliestDeadline) {
                const daysUntilDeadline = Math.max(1, Math.ceil((earliestDeadline.getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)));
                const requiredDailyHours = totalRemainingHours / daysUntilDeadline;
                const maxReasonableDailyHours = settings.dailyAvailableHours * 1.2; // 20% tolerance

                // If schedule would be overwhelming, show a gentle warning
                if (requiredDailyHours > maxReasonableDailyHours) {
                    const reductionNeeded = totalRemainingHours - (maxReasonableDailyHours * daysUntilDeadline);
                    setNotificationMessage(
                        `💡 Heads up: Your remaining ${totalRemainingHours.toFixed(1)} hours might be tight to fit in ${daysUntilDeadline} days (needs ${requiredDailyHours.toFixed(1)}h/day vs your ${settings.dailyAvailableHours}h limit). ` +
                        `Consider reducing task hours by ~${reductionNeeded.toFixed(1)}h or extending deadlines for a more manageable schedule.`
                    );
                    setTimeout(() => setNotificationMessage(null), 8000);
                }
            }
            // Check if there are manually rescheduled sessions that will be affected
            const hasManualReschedules = studyPlans.some(plan =>
                plan.plannedTasks.some(session =>
                    session.originalTime && session.originalDate && session.isManualOverride
                )
            );

            if (hasManualReschedules) {
                // For regular study plan generation, preserve manual reschedules by default
                // Use the refresh function for options to reset reschedules
                    // Generate plan but preserve manual reschedules
                    const result = generateNewStudyPlanWithPreservation(tasks, settings, getAllCommitmentsForScheduling(), studyPlans);
                    const newPlans = result.plans;
                    
                    // Enhanced preservation logic
                    newPlans.forEach(plan => {
                        const prevPlan = studyPlans.find(p => p.date === plan.date);
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
                                // Preserve skipped sessions
                                else if (prevSession.status === 'skipped') {
                                    session.status = 'skipped';
                                }
                                // Preserve manual reschedules with their new times
                                else if (prevSession.originalTime && prevSession.originalDate && prevSession.isManualOverride) {
                                    session.originalTime = prevSession.originalTime;
                                    session.originalDate = prevSession.originalDate;
                                    session.rescheduledAt = prevSession.rescheduledAt;
                                    session.isManualOverride = prevSession.isManualOverride;
                                    // Keep the rescheduled times
                                    session.startTime = prevSession.startTime;
                                    session.endTime = prevSession.endTime;
                                    // Move session to the rescheduled date if different
                                    if (prevSession.originalDate !== plan.date) {
                                        const targetPlan = newPlans.find(p => p.date === prevSession.originalDate);
                                        if (targetPlan) {
                                            targetPlan.plannedTasks.push(session);
                                            plan.plannedTasks = plan.plannedTasks.filter(s => s !== session);
                                        }
                                    }
                                }
                            }
                        });
                    });
                    
                    setStudyPlans(newPlans);
                    setLastPlanStaleReason("task");
                    return;
            }

            // Generate new study plan, preserving manual schedules
            const result = generateNewStudyPlanWithPreservation(tasks, settings, getAllCommitmentsForScheduling(), studyPlans);
            const newPlans = result.plans;
            
            // Preserve session status from previous plan
            newPlans.forEach(plan => {
                const prevPlan = studyPlans.find(p => p.date === plan.date);
                if (!prevPlan) return;
                
                // Preserve session status and properties
                plan.plannedTasks.forEach(session => {
                    const prevSession = prevPlan.plannedTasks.find(s => s.taskId === session.taskId && s.sessionNumber === session.sessionNumber);
                    if (prevSession) {
                        // Preserve done sessions
                        if (prevSession.done) {
                            session.done = true;
                            session.status = prevSession.status;
                            session.actualHours = prevSession.actualHours;
                            session.completedAt = prevSession.completedAt;
                        }
                        // Preserve skipped sessions
                        else if (prevSession.status === 'skipped') {
                            session.status = 'skipped';
                        }
                        // Preserve rescheduled sessions (but allow regeneration of times)
                        else if (prevSession.originalTime && prevSession.originalDate) {
                            session.originalTime = prevSession.originalTime;
                            session.originalDate = prevSession.originalDate;
                            session.rescheduledAt = prevSession.rescheduledAt;
                            session.isManualOverride = prevSession.isManualOverride;
                        }
                    }
                });
            });
            
            setStudyPlans(newPlans);
            setLastPlanStaleReason("task");
        }
    };



    // Handle refresh study plan with preserve option (no browser dialog)
    const handleRefreshStudyPlan = (preserveManualReschedules: boolean) => {
        if (tasks.length > 0) {
            try {
                // Generate new study plan
                const result = preserveManualReschedules
                    ? generateNewStudyPlanWithPreservation(tasks, settings, getAllCommitmentsForScheduling(), studyPlans)
                    : generateNewStudyPlan(tasks, settings, getAllCommitmentsForScheduling(), studyPlans);
                const newPlans = result.plans;

                if (preserveManualReschedules) {
                    // Enhanced preservation logic
                    newPlans.forEach(plan => {
                        const prevPlan = studyPlans.find(p => p.date === plan.date);
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
                                // Preserve skipped sessions
                                else if (prevSession.status === 'skipped') {
                                    session.status = 'skipped';
                                }
                                // Preserve manual reschedules
                                else if (prevSession.originalTime && prevSession.originalDate && prevSession.isManualOverride) {
                                    session.originalTime = prevSession.originalTime;
                                    session.originalDate = prevSession.originalDate;
                                    session.startTime = prevSession.startTime;
                                    session.endTime = prevSession.endTime;
                                    session.rescheduledAt = prevSession.rescheduledAt;
                                    session.isManualOverride = prevSession.isManualOverride;
                                }
                                // Preserve other rescheduled sessions (but allow regeneration of times)
                                else if (prevSession.originalTime && prevSession.originalDate) {
                                    session.originalTime = prevSession.originalTime;
                                    session.originalDate = prevSession.originalDate;
                                    session.rescheduledAt = prevSession.rescheduledAt;
                                    session.isManualOverride = prevSession.isManualOverride;
                                }
                            }
                        });
                    });
                } else {
                    // Only preserve done and skipped sessions, reset manual reschedules
                    newPlans.forEach(plan => {
                        const prevPlan = studyPlans.find(p => p.date === plan.date);
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
                                // Preserve skipped sessions
                                else if (prevSession.status === 'skipped') {
                                    session.status = 'skipped';
                                }
                            }
                        });
                    });
                }

                setStudyPlans(newPlans);
                setLastPlanStaleReason("task");
                setNotificationMessage(preserveManualReschedules ?
                    'Study plan refreshed! Manual reschedules preserved.' :
                    'Study plan refreshed! All sessions optimally rescheduled.'
                );
                setTimeout(() => setNotificationMessage(''), 5000);
            } catch (error) {
                console.error('Study plan refresh failed:', error);
                setNotificationMessage('Failed to refresh study plan. Please try again.');
                setTimeout(() => setNotificationMessage(''), 5000);
            }
        }
    };

    const handleDismissAutoRemovedTask = (taskTitle: string) => {
      setAutoRemovedTasks(prev => prev.filter(title => title !== taskTitle));
    };

    const handleAddTask = (taskData: Omit<Task, 'id' | 'createdAt'>) => {
        const newTask: Task = {
            ...taskData,
            id: Date.now().toString(),
            createdAt: new Date().toISOString()
        };
        const updatedTasks = [...tasks, newTask];

        // Centralized feasibility assessment
        const feasibility = assessAddTaskFeasibility(newTask, updatedTasks, settings, getAllCommitmentsForScheduling(), studyPlans);

        if (feasibility.blocksNewTask) {
            setNotificationMessage(
              `Task "${newTask.title}" ${feasibility.reason} with your current settings.\n` +
              `Try one or more of the following:\n` +
              ` Reduce the estimated hours for this task\n` +
              ` Adjust the deadline to allow more time\n` +
              ` Increase your daily available study hours in Settings\n` +
              ` Remove or reschedule other tasks\n` +
              ` Adjust your study window hours in Settings\n`
            );
            setTasks(tasks);
            // Use preservation function to maintain manual schedules even when restoring
            const { plans: restoredPlans } = generateNewStudyPlanWithPreservation(tasks, settings, fixedCommitments, studyPlans);
            setStudyPlans(restoredPlans);
            setShowTaskInput(false);
            setLastPlanStaleReason("task");
            return;
        }

        setTasks(updatedTasks);
        setStudyPlans(feasibility.plans);
        setShowTaskInput(false);
        setLastPlanStaleReason("task");
    };

    // Helper function to get all commitments in format expected by scheduling functions
    const getAllCommitmentsForScheduling = (): FixedCommitment[] => {
        return fixedCommitments;
    };


    const handleAddFixedCommitment = async (commitmentData: Omit<FixedCommitment, 'id' | 'createdAt'>) => {
        const newCommitment: FixedCommitment = {
            ...commitmentData,
            type: 'fixed',
            id: Date.now().toString(),
            createdAt: new Date().toISOString()
        };
        // Handle override logic for commitments
        let updatedCommitments = [...fixedCommitments];
        
        if (!newCommitment.recurring && newCommitment.specificDates) {
            // For one-time commitments, check if they conflict with recurring commitments
            const conflicts = checkCommitmentConflicts(newCommitment, fixedCommitments);
            
            if (conflicts.hasConflict && conflicts.conflictType === 'override' && conflicts.conflictingCommitment) {
                // Add the conflicting dates to the recurring commitment's deletedOccurrences
                const conflictingCommitment = conflicts.conflictingCommitment;
                const updatedConflictingCommitment = {
                    ...conflictingCommitment,
                    deletedOccurrences: [
                        ...(conflictingCommitment.deletedOccurrences || []),
                        ...(conflicts.conflictingDates || [])
                    ]
                };
                
                // Update the conflicting commitment
                updatedCommitments = updatedCommitments.map(commitment => 
                    commitment.id === conflictingCommitment.id 
                        ? updatedConflictingCommitment 
                        : commitment
                );
            }
        } else if (newCommitment.recurring && newCommitment.daysOfWeek) {
            // For recurring commitments, check if they conflict with one-time commitments
            const conflicts = checkCommitmentConflicts(newCommitment, fixedCommitments);
            
            if (conflicts.hasConflict && conflicts.conflictType === 'override' && conflicts.conflictingDates) {
                // Add the conflicting dates to the new recurring commitment's deletedOccurrences
                newCommitment.deletedOccurrences = [
                    ...(newCommitment.deletedOccurrences || []),
                    ...conflicts.conflictingDates
                ];
            }
        }
        
        // Add the new commitment
        updatedCommitments = [...updatedCommitments, newCommitment];
        setFixedCommitments(updatedCommitments);
        
        // Regenerate study plan with new commitment, preserving manual schedules
        if (tasks.length > 0) {
            const { plans: newPlans } = generateNewStudyPlanWithPreservation(tasks, settings, updatedCommitments, studyPlans);
            setStudyPlans(newPlans);
            setLastPlanStaleReason("commitment");
        }
    };


    const handleDeleteCommitment = async (commitmentId: string) => {
        // Handle fixed commitment deletion
        const commitmentToDelete = fixedCommitments.find(c => c.id === commitmentId);
        if (!commitmentToDelete) return;

        // Remove the commitment from the array
        let updatedCommitments = fixedCommitments.filter(commitment => commitment.id !== commitmentId);

        // If deleting a one-time commitment, restore any overridden recurring commitments
        if (commitmentToDelete && !commitmentToDelete.recurring && commitmentToDelete.specificDates) {
            // Find recurring commitments that may have been overridden by this one-time commitment
            updatedCommitments = updatedCommitments.map(commitment => {
                if (!commitment.recurring || !commitment.deletedOccurrences) {
                    return commitment; // Skip non-recurring or commitments without deleted occurrences
                }

                // Check if this recurring commitment has any dates that were overridden by the deleted one-time commitment
                const deletedDatesToRestore = commitmentToDelete.specificDates?.filter(date => {
                    const dayOfWeek = new Date(date).getDay();
                    // Check if the date matches this recurring commitment's schedule and is in deletedOccurrences
                    return commitment.daysOfWeek.includes(dayOfWeek) &&
                           commitment.deletedOccurrences?.includes(date);
                }) || [];

                // If there are dates to restore, remove them from deletedOccurrences
                if (deletedDatesToRestore.length > 0) {
                    return {
                        ...commitment,
                        deletedOccurrences: commitment.deletedOccurrences.filter(date =>
                            !deletedDatesToRestore.includes(date)
                        )
                    };
                }

                return commitment;
            });
        }

        setFixedCommitments(updatedCommitments);
        
        // Regenerate study plan with updated commitments, preserving manual schedules
        if (tasks.length > 0) {
            const { plans: newPlans } = generateNewStudyPlanWithPreservation(tasks, settings, updatedCommitments, studyPlans);
            
            // Preserve session status from previous plan
            newPlans.forEach(plan => {
                const prevPlan = studyPlans.find(p => p.date === plan.date);
                if (!prevPlan) return;
                
                // Preserve session status and properties
                plan.plannedTasks.forEach(session => {
                    const prevSession = prevPlan.plannedTasks.find(s => s.taskId === session.taskId && s.sessionNumber === session.sessionNumber);
                    if (prevSession) {
                        // Preserve done sessions
                        if (prevSession.done) {
                            session.done = true;
                            session.status = prevSession.status;
                            session.actualHours = prevSession.actualHours;
                            session.completedAt = prevSession.completedAt;
                        }
                        // Preserve skipped sessions
                        else if (prevSession.status === 'skipped') {
                            session.status = 'skipped';
                        }
                        // Preserve rescheduled sessions
                        else if (prevSession.originalTime && prevSession.originalDate) {
                            session.originalTime = prevSession.originalTime;
                            session.originalDate = prevSession.originalDate;
                            session.rescheduledAt = prevSession.rescheduledAt;
                            session.isManualOverride = prevSession.isManualOverride;
                        }
                    }
                });
            });
            
            setStudyPlans(newPlans);
        setLastPlanStaleReason("commitment");
        }
    };

    const handleUpdateFixedCommitment = (commitmentId: string, updates: Partial<FixedCommitment>) => {
        // Get the original commitment before updates
        const originalCommitment = fixedCommitments.find(c => c.id === commitmentId);

        // First, update the commitment
        let updatedCommitments = fixedCommitments.map(commitment =>
            commitment.id === commitmentId ? { ...commitment, ...updates } : commitment
        );

        // If updating a one-time commitment, first restore any previously overridden recurring commitments
        if (originalCommitment && !originalCommitment.recurring && originalCommitment.specificDates) {
            // Restore dates that were previously overridden but are no longer conflicting
            updatedCommitments = updatedCommitments.map(commitment => {
                if (!commitment.recurring || !commitment.deletedOccurrences) {
                    return commitment;
                }

                // Find dates that were overridden by the original one-time commitment
                const previouslyOverriddenDates = originalCommitment.specificDates?.filter(date => {
                    const dayOfWeek = new Date(date).getDay();
                    return commitment.daysOfWeek.includes(dayOfWeek) &&
                           commitment.deletedOccurrences?.includes(date);
                }) || [];

                // Remove these dates from deletedOccurrences (they will be re-added later if still conflicting)
                if (previouslyOverriddenDates.length > 0) {
                    return {
                        ...commitment,
                        deletedOccurrences: commitment.deletedOccurrences.filter(date =>
                            !previouslyOverriddenDates.includes(date)
                        )
                    };
                }

                return commitment;
            });
        }

        // Handle override logic for commitments
        const updatedCommitment = updatedCommitments.find(c => c.id === commitmentId);
        if (updatedCommitment) {
            if (!updatedCommitment.recurring && updatedCommitment.specificDates) {
                // For one-time commitments, check if they conflict with recurring commitments
                const conflicts = checkCommitmentConflicts(updatedCommitment, fixedCommitments, commitmentId);
                
                if (conflicts.hasConflict && conflicts.conflictType === 'override' && conflicts.conflictingCommitment) {
                    // Add the conflicting dates to the recurring commitment's deletedOccurrences
                    const conflictingCommitment = conflicts.conflictingCommitment;
                    const updatedConflictingCommitment = {
                        ...conflictingCommitment,
                        deletedOccurrences: [
                            ...(conflictingCommitment.deletedOccurrences || []),
                            ...(conflicts.conflictingDates || [])
                        ]
                    };
                    
                    // Update the conflicting commitment
                    updatedCommitments = updatedCommitments.map(commitment => 
                        commitment.id === conflictingCommitment.id 
                            ? updatedConflictingCommitment 
                            : commitment
                    );
                }
            } else if (updatedCommitment.recurring && updatedCommitment.daysOfWeek) {
                // For recurring commitments, check if they conflict with one-time commitments
                const conflicts = checkCommitmentConflicts(updatedCommitment, fixedCommitments, commitmentId);
                
                if (conflicts.hasConflict && conflicts.conflictType === 'override' && conflicts.conflictingDates) {
                    // Add the conflicting dates to the updated recurring commitment's deletedOccurrences
                    const updatedCommitmentWithDeletedOccurrences = {
                        ...updatedCommitment,
                        deletedOccurrences: [
                            ...(updatedCommitment.deletedOccurrences || []),
                            ...conflicts.conflictingDates
                        ]
                    };
                    
                    // Update the commitment being edited
                    updatedCommitments = updatedCommitments.map(commitment => 
                        commitment.id === commitmentId 
                            ? updatedCommitmentWithDeletedOccurrences 
                            : commitment
                    );
                }
            }
        }

        setFixedCommitments(updatedCommitments);

        // Check if this is only a timing update (drag and drop) vs structural change
        const isTimingOnlyUpdate = originalCommitment && updates && Object.keys(updates).every(key =>
            key === 'modifiedOccurrences' || key === 'daySpecificTimings'
        );

        // Only regenerate study plan if this is NOT just a timing update
        // Timing updates (drag/drop) shouldn't affect study sessions scheduling
        if (!isTimingOnlyUpdate && tasks.length > 0) {
            const { plans: newPlans } = generateNewStudyPlanWithPreservation(tasks, settings, updatedCommitments, studyPlans);

            // Preserve session status from previous plan
            newPlans.forEach(plan => {
                const prevPlan = studyPlans.find(p => p.date === plan.date);
                if (!prevPlan) return;

                // Preserve session status and properties
                plan.plannedTasks.forEach(session => {
                    const prevSession = prevPlan.plannedTasks.find(s => s.taskId === session.taskId && s.sessionNumber === session.sessionNumber);
                    if (prevSession) {
                        // Preserve done sessions
                        if (prevSession.done) {
                            session.done = true;
                            session.status = prevSession.status;
                            session.actualHours = prevSession.actualHours;
                            session.completedAt = prevSession.completedAt;
                        }
                        // Preserve skipped sessions
                        else if (prevSession.status === 'skipped') {
                            session.status = 'skipped';
                        }
                        // Preserve rescheduled sessions
                        else if (prevSession.originalTime && prevSession.originalDate) {
                            session.originalTime = prevSession.originalTime;
                            session.originalDate = prevSession.originalDate;
                            session.rescheduledAt = prevSession.rescheduledAt;
                            session.isManualOverride = prevSession.isManualOverride;
                        }
                    }
                });
            });

            setStudyPlans(newPlans);
            setLastPlanStaleReason("commitment");
        }
    };


    const handleUpdateTask = (taskId: string, updates: Partial<Task>) => {
        const originalTask = tasks.find(task => task.id === taskId);
        const updatedTasks = tasks.map(task =>
            task.id === taskId ? { ...task, ...updates } : task
        );

        // Check if estimated time changed and adjust sessions intelligently
        const timeChanged = originalTask && updates.estimatedHours !== undefined &&
                           originalTask.estimatedHours !== updates.estimatedHours;

        if (timeChanged && originalTask) {
            const oldEstimatedHours = originalTask.estimatedHours;
            const newEstimatedHours = updates.estimatedHours!;

            // Calculate completed/skipped hours to preserve them
            let completedHours = 0;
            let remainingSessions: any[] = [];

            studyPlans.forEach(plan => {
                plan.plannedTasks.forEach(session => {
                    if (session.taskId === taskId) {
                        if (session.done || session.status === 'completed' || session.status === 'skipped') {
                            // This session is completed/skipped - preserve it and count its hours
                            completedHours += session.allocatedHours;
                        } else {
                            // This is a remaining session that can be adjusted
                            remainingSessions.push({...session, planDate: plan.date});
                        }
                    }
                });
            });

            // Calculate new remaining hours after accounting for completed work
            const newRemainingHours = Math.max(0, newEstimatedHours - completedHours);

            if (remainingSessions.length > 0 && newRemainingHours > 0) {
                // Distribute the new remaining hours across the remaining sessions
                const hoursPerSession = newRemainingHours / remainingSessions.length;

                // Update the remaining sessions with new durations
                studyPlans.forEach(plan => {
                    plan.plannedTasks.forEach(session => {
                        if (session.taskId === taskId && !session.done && session.status !== 'completed' && session.status !== 'skipped') {
                            // Update session duration
                            session.allocatedHours = hoursPerSession;

                            // Update end time based on new duration
                            const [startHour, startMinute] = session.startTime.split(':').map(Number);
                            const durationMinutes = Math.round(hoursPerSession * 60);
                            const newEndTime = new Date();
                            newEndTime.setHours(startHour, startMinute + durationMinutes, 0, 0);
                            session.endTime = `${newEndTime.getHours().toString().padStart(2, '0')}:${newEndTime.getMinutes().toString().padStart(2, '0')}`;
                        }
                    });
                });
            } else if (remainingSessions.length > 0 && newRemainingHours === 0) {
                // New estimated time is less than or equal to completed work - remove remaining sessions
                studyPlans.forEach(plan => {
                    plan.plannedTasks = plan.plannedTasks.filter(session => {
                        if (session.taskId === taskId) {
                            // Keep completed/skipped sessions, remove others
                            return session.done || session.status === 'completed' || session.status === 'skipped';
                        }
                        return true;
                    });
                });

                // Mark task as completed if all remaining work is done
                if (completedHours >= newEstimatedHours) {
                    updatedTasks.forEach(task => {
                        if (task.id === taskId) {
                            task.status = 'completed';
                            task.estimatedHours = completedHours; // Set to actual completed hours
                        }
                    });
                }
            }

            // Also handle manual override sessions proportionally (existing logic)
            studyPlans.forEach(plan => {
                plan.plannedTasks.forEach(session => {
                    if (session.taskId === taskId && session.isManualOverride && session.originalTime && session.originalDate) {
                        // Only adjust if this session wasn't already handled above (i.e., it's not completed)
                        if (!session.done && session.status !== 'completed' && session.status !== 'skipped') {
                            const [startHour, startMinute] = session.startTime.split(':').map(Number);
                            const [endHour, endMinute] = session.endTime.split(':').map(Number);
                            const currentDuration = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
                            const timeRatio = newEstimatedHours / (oldEstimatedHours || 1);
                            const newDuration = Math.max(15, Math.round(currentDuration * timeRatio)); // Minimum 15 minutes

                            // Update the end time based on new duration
                            const newEndTime = new Date();
                            newEndTime.setHours(startHour, startMinute + newDuration, 0, 0);
                            session.endTime = `${newEndTime.getHours().toString().padStart(2, '0')}:${newEndTime.getMinutes().toString().padStart(2, '0')}`;
                            session.allocatedHours = newDuration / 60;
                        }
                    }
                });
            });
        }
        
        // Generate new study plan with updated tasks, preserving manual schedules
        const { plans: newPlans } = generateNewStudyPlanWithPreservation(updatedTasks, settings, fixedCommitments, studyPlans);

        // Preserve session status from previous plan
        newPlans.forEach(plan => {
            const prevPlan = studyPlans.find(p => p.date === plan.date);
            if (!prevPlan) return;

            // Preserve session status and properties
            plan.plannedTasks.forEach(session => {
                const prevSession = prevPlan.plannedTasks.find(s => s.taskId === session.taskId && s.sessionNumber === session.sessionNumber);
                if (prevSession) {
                    // Preserve done sessions completely - including duration
                    if (prevSession.done) {
                        session.done = true;
                        session.status = prevSession.status;
                        session.actualHours = prevSession.actualHours;
                        session.completedAt = prevSession.completedAt;
                        // Critical: preserve the duration and timing for completed sessions
                        session.allocatedHours = prevSession.allocatedHours;
                        session.startTime = prevSession.startTime;
                        session.endTime = prevSession.endTime;
                    }
                    // Preserve skipped sessions completely - including duration
                    else if (prevSession.status === 'skipped') {
                        session.status = 'skipped';
                        // Also preserve duration for skipped sessions
                        session.allocatedHours = prevSession.allocatedHours;
                        session.startTime = prevSession.startTime;
                        session.endTime = prevSession.endTime;
                    }
                    // Preserve rescheduled sessions
                    else if (prevSession.originalTime && prevSession.originalDate) {
                        session.originalTime = prevSession.originalTime;
                        session.originalDate = prevSession.originalDate;
                        session.rescheduledAt = prevSession.rescheduledAt;
                        session.isManualOverride = prevSession.isManualOverride;
                    }
                }
            });
        });

        setTasks(updatedTasks);
        setStudyPlans(newPlans);
        setLastPlanStaleReason("task");
    };

    const handleDeleteTask = async (taskId: string) => {
        const updatedTasks = tasks.filter(task => task.id !== taskId);
        setTasks(updatedTasks);

        // Clean up study plans by removing all sessions for the deleted task
        const cleanedPlans = studyPlans.map(plan => ({
            ...plan,
            plannedTasks: plan.plannedTasks.filter(session => session.taskId !== taskId)
        })).filter(plan => plan.plannedTasks.length > 0); // Remove empty plans

        if (currentTask?.id === taskId) {
            setCurrentTask(null);
        }
        setLastPlanStaleReason("task");

        // Use unified redistribution system after task deletion, preserving manual schedules
        try {
            const result = generateNewStudyPlanWithPreservation(updatedTasks, settings, fixedCommitments, cleanedPlans);
            setStudyPlans(result.plans);
            setNotificationMessage('Study plan updated after deleting task.');
            setTimeout(() => setNotificationMessage(null), 3000);
        } catch (error) {
            console.error('Error updating study plan after task deletion:', error);
            setStudyPlans(cleanedPlans); // Fallback to cleaned plans
            setNotificationMessage('Task deleted. Study plan may need manual adjustment.');
            setTimeout(() => setNotificationMessage(null), 3000);
        }
    };

    // Update handleSelectTask to also store planDate and sessionNumber if available
    // Handle commitment timer completion separately from task completion
    const handleCommitmentTimerComplete = (commitment: FixedCommitment, hoursSpent: number) => {
        // Update gamification stats for commitment completion
        setGamificationData(prevData => {
            // Ensure prevData.stats exists with defaults
            const currentStats = prevData.stats || {
                totalStudyHours: 0,
                totalTasksCompleted: 0,
                currentStreak: 0,
                longestStreak: 0,
                perfectWeeks: 0,
                earlyFinishes: 0,
                totalSessions: 0,
                averageSessionLength: 0,
                favoriteStudyTime: 'morning' as const,
                efficiencyScore: 100,
                level: 1,
                totalPoints: 0,
                joinedDate: new Date().toISOString(),
                lastActiveDate: new Date().toISOString()
            };

            // Create a simulated study plan for the commitment completion to update stats correctly
            const today = new Date().toISOString().split('T')[0];
            const commitmentSession = {
                taskId: commitment.id,
                sessionNumber: 1,
                allocatedHours: hoursSpent,
                actualHours: hoursSpent,
                status: 'completed' as const,
                done: true,
                startTime: '00:00',
                endTime: '00:00',
                completedAt: new Date().toISOString()
            };

            // Create or update today's plan with the commitment session
            const existingTodayPlan = studyPlans.find(plan => plan.date === today);
            const updatedStudyPlans = existingTodayPlan
                ? studyPlans.map(plan =>
                    plan.date === today
                        ? { ...plan, plannedTasks: [...plan.plannedTasks, commitmentSession] }
                        : plan
                  )
                : [...studyPlans, {
                    id: `${today}-commitment`,
                    date: today,
                    plannedTasks: [commitmentSession],
                    totalStudyHours: hoursSpent,
                    availableHours: hoursSpent
                  }];

            const updatedStats = updateUserStats(currentStats, updatedStudyPlans, tasks);
            const updatedStreak = updateStudyStreak(prevData.streak || { current: 0, longest: 0, lastStudyDate: '', streakDates: [] }, updatedStudyPlans);

            const unlockedAchievements = checkAchievementUnlocks(
                prevData.unlockedAchievements || [],
                updatedStats,
                updatedStreak
            );

            // Show achievement notification if any unlocked
            if (unlockedAchievements.length > 0) {
                const firstUnlockedId = unlockedAchievements[0];
                const achievementObj = ACHIEVEMENTS.find(a => a.id === firstUnlockedId);
                if (achievementObj) {
                    setAchievementNotification(achievementObj);
                }
            }

            return {
                ...prevData,
                stats: updatedStats,
                streak: updatedStreak,
                achievements: (prevData.achievements || []).map(achievement => {
                    const unlocked = unlockedAchievements.find(a => a.id === achievement.id);
                    return unlocked ? { ...achievement, unlockedAt: unlocked.unlockedAt } : achievement;
                })
            };
        });

        // Add to completed commitments history
        const completedDate = new Date().toISOString().split('T')[0];
        const completedRecord = {
            commitmentId: commitment.id,
            title: commitment.title,
            date: completedDate,
            duration: currentSession?.allocatedHours || 0,
            actualHours: hoursSpent,
            completedAt: new Date().toISOString()
        };
        setCompletedCommitments(prev => [...prev, completedRecord]);

        // Mark the commitment as completed for this date using cancellation logic
        // This ensures it gets removed from the study plan and calendar
        if (commitment.recurring) {
            // For recurring commitments, add this date to deletedOccurrences
            setFixedCommitments(prevCommitments =>
                prevCommitments.map(c =>
                    c.id === commitment.id
                        ? {
                            ...c,
                            deletedOccurrences: [...(c.deletedOccurrences || []), completedDate]
                        }
                        : c
                )
            );
        } else {
            // For one-time commitments, remove the specific date from specificDates
            setFixedCommitments(prevCommitments =>
                prevCommitments.map(c =>
                    c.id === commitment.id
                        ? {
                            ...c,
                            specificDates: c.specificDates?.filter(d => d !== completedDate) || []
                        }
                        : c
                )
            );
        }

        // Clear the commitment timer state
        setCurrentCommitment(null);
        setCurrentTask(null);
        setCurrentSession(null);

        // Show completion message
        setNotificationMessage(`Commitment "${commitment.title}" completed! Time spent: ${formatTime(hoursSpent)}`);
        setTimeout(() => setNotificationMessage(''), 5000);

        // Navigate back to plan view
        setActiveTab('plan');
    };

    // Handle skipping/cancelling commitments
    const handleSkipCommitment = (commitmentId: string, date: string) => {
        // Find the commitment
        const commitment = fixedCommitments.find(c => c.id === commitmentId);
        if (!commitment) return;

        // For recurring commitments, add this date to deletedOccurrences
        if (commitment.recurring) {
            setFixedCommitments(prevCommitments =>
                prevCommitments.map(c =>
                    c.id === commitmentId
                        ? {
                            ...c,
                            deletedOccurrences: [...(c.deletedOccurrences || []), date]
                        }
                        : c
                )
            );
            setNotificationMessage(`Commitment "${commitment.title}" cancelled for ${new Date(date).toLocaleDateString()}`);
        } else {
            // For one-time commitments, remove the specific date from specificDates
            setFixedCommitments(prevCommitments =>
                prevCommitments.map(c =>
                    c.id === commitmentId
                        ? {
                            ...c,
                            specificDates: c.specificDates?.filter(d => d !== date) || []
                        }
                        : c
                )
            );
            setNotificationMessage(`Commitment "${commitment.title}" cancelled`);
        }

        setTimeout(() => setNotificationMessage(''), 5000);
    };

    const handleSelectCommitment = (commitment: FixedCommitment, duration: number) => {
        // Only allow timer for commitments that count toward daily hours
        if (!commitment.countsTowardDailyHours) return;

        // First, ensure any running timer is stopped to prevent race conditions
        setGlobalTimer(prev => ({
            ...prev,
            isRunning: false,
            startTime: undefined,
            pausedTime: undefined,
            lastUpdateTime: undefined
        }));

        const durationSeconds = duration * 3600; // Convert hours to seconds

        // Set the current commitment to distinguish from tasks
        setCurrentCommitment(commitment);
        setCurrentTask({
            id: commitment.id,
            title: commitment.title,
            estimatedHours: duration,
            status: 'pending' as const,
            importance: false,
            deadline: '',
            createdAt: commitment.createdAt,
            description: commitment.description || '',
            category: commitment.category,
        });
        setCurrentSession({
            allocatedHours: duration
            // Don't set planDate and sessionNumber for commitments
            // This ensures StudyTimer calls onTimerComplete instead of onMarkSessionDone
        });
        setActiveTab('timer');

        // Use setTimeout to ensure the timer state is reset after the current execution cycle
        // This prevents race conditions with the useRobustTimer hook
        setTimeout(() => {
            setGlobalTimer({
                isRunning: false,
                currentTime: durationSeconds,
                totalTime: durationSeconds,
                currentTaskId: commitment.id,
                startTime: undefined,
                pausedTime: undefined,
                lastUpdateTime: undefined
            });
        }, 0);
    };

    const handleSelectTask = (task: Task, session?: { allocatedHours: number; planDate?: string; sessionNumber?: number }) => {
        // Reset timer controls processing flag
        timerControlsRef.current.isProcessing = false;

        // Calculate time for new session/task
        const timeToUse = session?.allocatedHours || task.estimatedHours;
        const timeInSeconds = Math.floor(timeToUse * 3600);

        // Immediately stop current timer and reset state to prevent race conditions
        setGlobalTimer({
            isRunning: false,
            currentTime: timeInSeconds,
            totalTime: timeInSeconds,
            currentTaskId: task.id,
            startTime: undefined,
            pausedTime: undefined,
            lastUpdateTime: undefined
        });

        // Update other state after timer is reset
        setCurrentTask(task);
        setCurrentCommitment(null); // Clear commitment state when selecting a regular task
        setCurrentSession(session || null);
        setActiveTab('timer');

        if (session?.planDate && session?.sessionNumber) {
            setLastTimedSession({ planDate: session.planDate, sessionNumber: session.sessionNumber });
        } else {
            setLastTimedSession(null); // Clear last timed session when selecting a new task
        }
    };

    // Update handleTimerComplete to set readyToMarkDone for the last-timed session
    // Timer control functions using robust timer helpers with debouncing
    const timerControlsRef = useRef({ isProcessing: false });

    const handleTimerStart = () => {
        if (timerControlsRef.current.isProcessing) return;
        timerControlsRef.current.isProcessing = true;

        setGlobalTimer(prev => {
            if (prev.isRunning) {
                timerControlsRef.current.isProcessing = false;
                return prev; // Already running
            }
            const newTimer = prev.startTime ? resumeTimer(prev) : startTimer(prev);
            setTimeout(() => { timerControlsRef.current.isProcessing = false; }, 100);
            return newTimer;
        });
    };

    const handleTimerPause = () => {
        if (timerControlsRef.current.isProcessing) return;
        timerControlsRef.current.isProcessing = true;

        setGlobalTimer(prev => {
            const newTimer = pauseTimer(prev);
            setTimeout(() => { timerControlsRef.current.isProcessing = false; }, 100);
            return newTimer;
        });
    };

    const handleTimerStop = () => {
        if (timerControlsRef.current.isProcessing) return;
        timerControlsRef.current.isProcessing = true;

        // Just stop the timer without marking session as done
        setGlobalTimer(prev => {
            const newTimer = pauseTimer(prev);
            setTimeout(() => { timerControlsRef.current.isProcessing = false; }, 100);
            return newTimer;
        });
    };

    const handleTimerReset = () => {
        if (timerControlsRef.current.isProcessing) return;
        timerControlsRef.current.isProcessing = true;

        setGlobalTimer(prev => {
            const newTimer = resetTimer(prev);
            setTimeout(() => { timerControlsRef.current.isProcessing = false; }, 100);
            return newTimer;
        });
    };

    // Speed up timer for testing purposes
    const handleTimerSpeedUp = () => {
        setGlobalTimer(prev => ({
            ...prev,
            currentTime: Math.max(0, prev.currentTime - 300) // Speed up by 5 minutes (300 seconds)
        }));
    };
    // Update timer to custom time
    const handleTimerUpdateTime = (newTimeInSeconds: number) => {
        const newTime = Math.max(0, newTimeInSeconds);
        setGlobalTimer(prev => ({
            ...prev,
            currentTime: newTime,
            totalTime: newTime, // Update totalTime so timer calculations use the edited value
            isRunning: false, // Ensure timer is paused when manually updated
            startTime: undefined,
            pausedTime: undefined,
            lastUpdateTime: performance.now()
        }));
    };
    const handleTimerComplete = (taskId: string, timeSpent: number) => {
        // Convert seconds to hours for calculation
        const hoursSpent = timeSpent / 3600;

        // Check if this is a commitment timer
        if (currentCommitment) {
            handleCommitmentTimerComplete(currentCommitment, hoursSpent);
            return;
        }

        // Find the session in studyPlans
        if (lastTimedSession) {
            // Removed readyToMarkDone state
        }

        // Record estimation data for learning
        const completedTask = tasks.find(t => t.id === taskId);
        if (completedTask && lastTimedSession) {
            const session = studyPlans
                .find(p => p.date === lastTimedSession.planDate)
                ?.plannedTasks.find(s => s.taskId === taskId && s.sessionNumber === lastTimedSession.sessionNumber);

            if (session) {
                // Track estimation accuracy for this session
                enhancedEstimationTracker.recordTaskCompletion(
                    session.allocatedHours,
                    hoursSpent,
                    {
                        taskType: completedTask.category || 'Other',
                        category: completedTask.category || 'Other',
                        complexity: 'medium', // TODO: Store complexity when task is created
                        timeOfDay: new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening',
                        dayOfWeek: new Date().getDay(),
                        isWeekend: [0, 6].includes(new Date().getDay()),
                        currentWorkload: 'medium', // TODO: Calculate based on schedule density
                        energyLevel: 'medium', // TODO: Allow user to rate this
                        hasDeadlinePressure: completedTask.deadline ? new Date(completedTask.deadline).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 : false,
                        isNewDomain: false, // TODO: Track this
                        requiresCreativity: false, // TODO: Track this
                        requiresResearch: false, // TODO: Track this
                        requiresCollaboration: false, // TODO: Track this
                        involvesTechnology: false, // TODO: Track this
                        similarTasksCompleted: 0, // TODO: Calculate this
                        recentAccuracy: 0.85, // TODO: Calculate this
                        availableTimeSlot: session.allocatedHours
                    }
                );
            }
        }

        // Don't modify task estimated hours - they should remain as the original estimation
        // Task completion is determined by session status, not by reducing estimated hours

        // Update study plans to mark session as done
        if (lastTimedSession) {
            setStudyPlans(prevPlans => {
                const updatedPlans = prevPlans.map(plan => {
                    if (plan.date === lastTimedSession.planDate) {
                        return {
                            ...plan,
                            plannedTasks: plan.plannedTasks.map(session => {
                                if (session.taskId === taskId && session.sessionNumber === lastTimedSession.sessionNumber) {
                                    const updatedSession: StudySession = {
                                        ...session,
                                        done: true,
                                        status: 'completed',
                                        actualHours: hoursSpent,
                                        completedAt: new Date().toISOString()
                                    };
                                    return updatedSession;
                                }
                                return session;
                            })
                        };
                    }
                    return plan;
                });
                
                // After updating the plans, check if this creates the edge case
                setTimeout(() => {
                    const wasHandled = checkAndHandleSkippedOnlyTask(taskId, updatedPlans);
                    if (!wasHandled) {
                        // If the task wasn't deleted, check if it should be completed
                        checkAndCompleteTask(taskId, updatedPlans);
                    }
                }, 0);
                
                // Update gamification after study plans are updated
                setTimeout(() => {
                    updateGamificationData(updatedPlans);
                }, 100);

                return updatedPlans;
            });
        }

        // Clear current task if it's completed
        if (completedTask && (completedTask.estimatedHours - hoursSpent) <= 0) {
            setCurrentTask(null);
        }

        // Clear commitment state (in case it was set by mistake)
        setCurrentCommitment(null);
    };

    // New function to handle when timer reaches zero and user wants to mark session as done
    const handleMarkSessionDoneFromTimer = (taskId: string, timeSpent: number) => {
        handleTimerComplete(taskId, timeSpent);
    };

    // Helper function to check if all sessions for a task are done and complete the task
    const checkAndCompleteTask = (taskId: string, updatedStudyPlans?: StudyPlan[]) => {
        // Use updated study plans if provided, otherwise use current state
        const plansToCheck = updatedStudyPlans || studyPlans;
        
        // Get all sessions for this task across all study plans
        const allSessionsForTask = plansToCheck.flatMap(plan => plan.plannedTasks).filter(s => s.taskId === taskId);
        
        // Check if all sessions are done (including skipped sessions)
        const allSessionsDone = allSessionsForTask.length > 0 && allSessionsForTask.every(session => 
            session.done || session.status === 'skipped'
        );
        
        if (allSessionsDone) {
            // Find the task
            const task = tasks.find(t => t.id === taskId);
            if (task && task.status !== 'completed') {
                // Calculate total hours from completed and skipped sessions
                const totalCompletedHours = allSessionsForTask.reduce((sum, session) => 
                    sum + (session.done || session.status === 'skipped' ? session.allocatedHours : 0), 0
                );
                
                // Update task status to completed without modifying estimated hours
                const updatedTasks = tasks.map(t =>
                    t.id === taskId
                        ? { ...t, status: 'completed' as const }
                        : t
                );
                
                setTasks(updatedTasks);

                // Don't regenerate study plan - just remove future sessions for this completed task
                setStudyPlans(prevPlans =>
                    prevPlans.map(plan => ({
                        ...plan,
                        plannedTasks: plan.plannedTasks.filter(session =>
                            session.taskId !== taskId || session.done || session.status === 'completed' || session.status === 'skipped'
                        )
                    }))
                );
                
                // Show completion notification
                setNotificationMessage(`Task completed: ${task.title}`);
                setTimeout(() => setNotificationMessage(null), 3000);
            }
        }
    };

    // Helper function to handle edge case: task with only one session that is skipped
    const checkAndHandleSkippedOnlyTask = (taskId: string, updatedStudyPlans?: StudyPlan[]) => {
        // Use updated study plans if provided, otherwise use current state
        const plansToCheck = updatedStudyPlans || studyPlans;
        
        // Get all sessions for this task across all study plans
        const allSessionsForTask = plansToCheck.flatMap(plan => plan.plannedTasks).filter(s => s.taskId === taskId);
        
        // Check if task has only one session and that session is skipped
        if (allSessionsForTask.length === 1 && allSessionsForTask[0].status === 'skipped') {
            const task = tasks.find(t => t.id === taskId);
            if (task && task.status === 'pending') {
                // This task has only one session and it's skipped, so mark it as completed
                // since skipped sessions are now treated as "done" for scheduling purposes
                const updatedTasks = tasks.map(t => 
                    t.id === taskId 
                        ? { ...t, status: 'completed' as const, completedAt: new Date().toISOString() }
                        : t
                );
                setTasks(updatedTasks);
                
                // Clear current task if it's the one being completed
                if (currentTask && currentTask.id === taskId) {
                    setCurrentTask(null);
                    setCurrentSession(null);
                }
                
                // Show completion notification
                setNotificationMessage(`Task "${task.title}" completed - all sessions were skipped`);
                setTimeout(() => setNotificationMessage(null), 3000);
                
                return true; // Indicate that the task was handled
            }
        }
        
        return false; // Task was not handled
    };


    // Handler to mark a session as done in studyPlans
    const handleMarkSessionDone = (planDate: string, sessionNumber: number) => {
        // Don't modify task estimated hours - they should remain as the original estimation
        // Task completion is determined by session status, not by reducing estimated hours

        setStudyPlans(prevPlans => {
            const updatedPlans = prevPlans.map(plan => {
                if (plan.date !== planDate) return plan;
                return {
                    ...plan,
                    plannedTasks: plan.plannedTasks.map(session => {
                        // Only mark the session as done if it matches both the sessionNumber AND the current task
                        if (session.sessionNumber === sessionNumber && currentTask && session.taskId === currentTask.id) {
                            const updatedSession = {
                                ...session,
                                done: true,
                                status: 'completed' as const,
                                actualHours: session.allocatedHours,
                                completedAt: new Date().toISOString()
                            };
                            
                            // Check if this completes the task with the updated plans
                            setTimeout(() => {
                                const wasHandled = checkAndHandleSkippedOnlyTask(session.taskId, updatedPlans);
                                if (!wasHandled) {
                                    checkAndCompleteTask(session.taskId, updatedPlans);
                                }
                              // Update gamification data after session completion
                                updateGamificationData(updatedPlans);
                            }, 0);
                            
                            return updatedSession;
                        }
                        return session;
                    })
                };
            });
            
            return updatedPlans;
        });
        
        // Show success notification
        if (currentTask) {
            setNotificationMessage(`Session completed: ${currentTask.title}`);
            setTimeout(() => setNotificationMessage(null), 3000);
        }
    };

    // Handler to undo marking a session as done
    const handleUndoSessionDone = (planDate: string, taskId: string, sessionNumber: number) => {
        setStudyPlans(prevPlans => {
            const updatedPlans = prevPlans.map(plan => {
                if (plan.date !== planDate) return plan;
                return {
                    ...plan,
                    plannedTasks: plan.plannedTasks.map(session => {
                        // Only undo the session if it matches both taskId and sessionNumber
                        if (session.taskId === taskId && session.sessionNumber === sessionNumber) {
                            const updatedSession = { ...session, done: false };
                            
                            // Check if this un-completes the task with the updated plans
                            setTimeout(() => {
                                const allSessionsForTask = updatedPlans.flatMap(plan => plan.plannedTasks).filter(s => s.taskId === taskId);
                                const allSessionsDone = allSessionsForTask.length > 0 && allSessionsForTask.every(session => 
                                    session.done || session.status === 'skipped'
                                );
                                
                                if (!allSessionsDone) {
                                    // Revert task status to pending if not all sessions are done
                                    const updatedTasks = tasks.map(t => 
                                        t.id === taskId 
                                            ? { ...t, status: 'pending' as const }
                                            : t
                                    );
                                    
                                    setTasks(updatedTasks);
                                    
                                    // Regenerate study plan with the updated task status, preserving manual schedules
                                    const { plans: newPlans } = generateNewStudyPlanWithPreservation(updatedTasks, settings, fixedCommitments, updatedPlans);
                                    
                                    // Preserve session status from previous plan
                                    newPlans.forEach(plan => {
                                        const prevPlan = updatedPlans.find(p => p.date === plan.date);
                                        if (!prevPlan) return;
                                        
                                        // Preserve session status and properties
                                        plan.plannedTasks.forEach(session => {
                                            const prevSession = prevPlan.plannedTasks.find(s => s.taskId === session.taskId && s.sessionNumber === session.sessionNumber);
                                            if (prevSession) {
                                                // Preserve done sessions
                                                if (prevSession.done) {
                                                    session.done = true;
                                                    session.status = prevSession.status;
                                                    session.actualHours = prevSession.actualHours;
                                                    session.completedAt = prevSession.completedAt;
                                                }
                                                // Preserve skipped sessions
                                                else if (prevSession.status === 'skipped') {
                                                    session.status = 'skipped';
                                                }
                                                // Preserve rescheduled sessions
                                                else if (prevSession.originalTime && prevSession.originalDate) {
                                                    session.originalTime = prevSession.originalTime;
                                                    session.originalDate = prevSession.originalDate;
                                                    session.rescheduledAt = prevSession.rescheduledAt;
                                                    session.isManualOverride = prevSession.isManualOverride;
                                                }
                                            }
                                        });
                                    });
                                    
                                    setStudyPlans(newPlans);
                                }
                            }, 0);
                            
                            return updatedSession;
                        }
                        return session;
                    })
                };
            });
            
            return updatedPlans;
        });
    };

    // Handler to skip a session
    const handleSkipSession = (planDate: string, taskId: string, sessionNumber: number) => {
        setStudyPlans(prevPlans => {
            const updatedPlans = prevPlans.map(plan => {
                if (plan.date !== planDate) return plan;
                return {
                    ...plan,
                    plannedTasks: plan.plannedTasks.map(session => {
                        // Only skip the session if it matches both taskId and sessionNumber
                        if (session.taskId === taskId && session.sessionNumber === sessionNumber) {
                            return {
                                ...session,
                                status: 'skipped',
                                skipMetadata: {
                                    skippedAt: new Date().toISOString(),
                                    reason: 'user_choice'
                                }
                            };
                        }
                        return session;
                    })
                };
            });

            // Check if skipping this session completes the task or handles edge cases
            setTimeout(() => {
                const wasHandled = checkAndHandleSkippedOnlyTask(taskId, updatedPlans);
                if (!wasHandled) {
                    // Check if all sessions are now done (including skipped sessions)
                    const allSessionsForTask = updatedPlans.flatMap(plan => plan.plannedTasks).filter(s => s.taskId === taskId);
                    const allSessionsDone = allSessionsForTask.length > 0 && allSessionsForTask.every(session =>
                        session.done || session.status === 'skipped'
                    );

                    if (allSessionsDone) {
                        // Mark task as completed
                        const task = tasks.find(t => t.id === taskId);
                        if (task && task.status !== 'completed') {
                            const updatedTasks = tasks.map(t =>
                                t.id === taskId
                                    ? { ...t, status: 'completed' as const }
                                    : t
                            );
                            setTasks(updatedTasks);

                            // Show completion notification
                            setNotificationMessage(`Task "${task.title}" completed - all sessions done`);
                            setTimeout(() => setNotificationMessage(null), 3000);
                        }
                    }
                }
            }, 0);

            return updatedPlans;
        });

        setNotificationMessage('Session skipped');
        setTimeout(() => setNotificationMessage(null), 3000);
    };

    // Completion flow handlers
    const handleContinueWithNextSession = () => {
        // Find the next available session for today
        const today = getLocalDateString();
        const todaysPlan = studyPlans.find(plan => plan.date === today);
        
        if (todaysPlan) {
            const nextSession = todaysPlan.plannedTasks.find(session => 
                !session.done && session.status !== 'completed' && session.status !== 'skipped'
            );
            
            if (nextSession) {
                const nextTask = tasks.find(t => t.id === nextSession.taskId);
                if (nextTask) {
                    handleSelectTask(nextTask, {
                        allocatedHours: nextSession.allocatedHours,
                        planDate: todaysPlan.date,
                        sessionNumber: nextSession.sessionNumber
                    });
                    setNotificationMessage(`Starting next session: ${nextTask.title}`);
                    setTimeout(() => setNotificationMessage(null), 3000);
                }
            } else {
                // No more sessions today, switch to dashboard
                setActiveTab('dashboard');
                setNotificationMessage('Great job! All sessions for today are complete.');
                setTimeout(() => setNotificationMessage(null), 3000);
            }
        } else {
            setActiveTab('dashboard');
        }
    };

    const handleTakeBreak = () => {
        // Switch to dashboard and show break message
        setActiveTab('dashboard');
        setNotificationMessage('Taking a break! Remember to stay hydrated and stretch.');
        setTimeout(() => setNotificationMessage(null), 3000);
    };

    const handleReviewCompletedWork = () => {
        // Switch to dashboard to review completed tasks
        setActiveTab('dashboard');
        setNotificationMessage('Review your completed work in the dashboard.');
        setTimeout(() => setNotificationMessage(null), 3000);
    };

    // Function to determine which settings are allowed during tutorial
    const getTutorialAllowedSettings = () => {
        if (!showInteractiveTutorial) return 'all';
        
        // Get current tutorial step from the tutorial component
        // For now, we'll use a simple approach based on the current tab
        if (activeTab === 'settings') {
            // During settings tutorial, allow study plan mode changes
            return ['studyPlanMode', 'darkMode', 'enableNotifications'];
        }
        
        return []; // Block all settings during other tutorial steps
    };

    // Function to check if a specific setting can be changed
    const canChangeSetting = (settingKey: string) => {
        // Block settings during active operations
        if (globalTimer.isRunning) {
            return false;
        }
        
        // Check tutorial restrictions
        const allowedSettings = getTutorialAllowedSettings();
        if (allowedSettings !== 'all' && !allowedSettings.includes(settingKey)) {
            return false;
        }
        
        // Block critical settings when no tasks exist
        if (tasks.length === 0 && ['studyPlanMode', 'dailyAvailableHours', 'workDays'].includes(settingKey)) {
            return false;
        }
        
        return true;
    };

    const handleUpdateSettings = (newSettings: UserSettings) => {
        // Check if any restricted settings are being changed
        const changedSettings = Object.keys(newSettings).filter(key => 
            newSettings[key as keyof UserSettings] !== settings[key as keyof UserSettings]
        );
        
        const blockedSettings = changedSettings.filter(setting => !canChangeSetting(setting));
        
        if (blockedSettings.length > 0) {
            let message = 'Cannot change settings at this time: ';
            if (globalTimer.isRunning) {
                message += 'Please stop the timer first.';
            } else if (showInteractiveTutorial) {
                message += 'Please complete the tutorial first.';
            } else if (tasks.length === 0) {
                message += 'Add some tasks first.';
            }
            setNotificationMessage(message);
            setTimeout(() => setNotificationMessage(null), 3000);
            return;
        }
        
        setSettings({ ...newSettings });
        localStorage.setItem('timepilot-settings', JSON.stringify({ ...newSettings }));
        
        // Auto-regenerate study plan with new settings, preserving manual schedules
        if (tasks.length > 0) {
            const { plans: newPlans } = generateNewStudyPlanWithPreservation(tasks, newSettings, fixedCommitments, studyPlans);
            
            // Preserve session status from previous plan
            newPlans.forEach(plan => {
                const prevPlan = studyPlans.find(p => p.date === plan.date);
                if (!prevPlan) return;
                
                // Preserve session status and properties
                plan.plannedTasks.forEach(session => {
                    const prevSession = prevPlan.plannedTasks.find(s => s.taskId === session.taskId && s.sessionNumber === session.sessionNumber);
                    if (prevSession) {
                        // Preserve done sessions
                        if (prevSession.done) {
                            session.done = true;
                            session.status = prevSession.status;
                            session.actualHours = prevSession.actualHours;
                            session.completedAt = prevSession.completedAt;
                        }
                        // Preserve skipped sessions
                        else if (prevSession.status === 'skipped') {
                            session.status = 'skipped';
                        }
                        // Preserve rescheduled sessions
                        else if (prevSession.originalTime && prevSession.originalDate) {
                            session.originalTime = prevSession.originalTime;
                            session.originalDate = prevSession.originalDate;
                            session.rescheduledAt = prevSession.rescheduledAt;
                            session.isManualOverride = prevSession.isManualOverride;
                        }
                    }
                });
            });
            
            setStudyPlans(newPlans);
        }
        
        setLastPlanStaleReason("settings");
    };

    const handleUpdateSettingsFromSuggestions = (updates: Partial<{
        dailyAvailableHours: number;
        workDays: number[];
        bufferDays: number;
    }>) => {
        const newSettings = { ...settings, ...updates };
        setSettings(newSettings);
        setIsPlanStale(true);
        // Clear suggestions after applying them
        // Removed setSuggestions([]);
    };

    const handleToggleDarkMode = () => {
        setDarkMode(prev => !prev);
    };


    // Interactive tutorial handlers
    const handleStartTutorial = () => {
        setShowInteractiveTutorial(true);
        setNotificationMessage('Starting interactive tutorial...');
        setTimeout(() => setNotificationMessage(null), 2000);
    };

    const handleRestartTutorial = () => {
        localStorage.removeItem('timepilot-interactive-tutorial-complete');
        setShowInteractiveTutorial(true);
        setNotificationMessage('Interactive tutorial restarted! Follow the guided steps.');
        setTimeout(() => setNotificationMessage(null), 3000);
    };

    const handleInteractiveTutorialComplete = () => {
        setShowInteractiveTutorial(false);
        localStorage.setItem('timepilot-interactive-tutorial-complete', 'true');
        setNotificationMessage('Interactive tutorial completed! You\'re ready to use TimePilot effectively.');
        setTimeout(() => setNotificationMessage(null), 3000);
    };

    // Onboarding handlers
    const handleCreateSampleSchedule = () => {
        // Create sample tasks and commitments
        const sampleTasks: Task[] = [
            {
                id: 'sample-1',
                title: 'Study for Math Exam',
                estimatedHours: 8,
                deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 1 week from now
                importance: true,
                category: 'Mathematics',
                status: 'pending',
                createdAt: new Date().toISOString()
            },
            {
                id: 'sample-2',
                title: 'Complete History Assignment',
                estimatedHours: 4,
                deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 5 days from now
                importance: false,
                category: 'History',
                status: 'pending',
                createdAt: new Date().toISOString()
            },
            {
                id: 'sample-3',
                title: 'Prepare Chemistry Lab Report',
                estimatedHours: 3,
                deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 3 days from now
                importance: false,
                category: 'Chemistry',
                status: 'pending',
                createdAt: new Date().toISOString()
            }
        ];

        const sampleCommitments: FixedCommitment[] = [
            {
                id: 'sample-commit-1',
                title: 'Math Class',
                startTime: '10:00',
                endTime: '11:30',
                daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
                category: 'Academic',
                location: 'Room 101',
                recurring: true,
                createdAt: new Date().toISOString()
            },
            {
                id: 'sample-commit-2',
                title: 'Part-time Job',
                startTime: '14:00',
                endTime: '18:00',
                daysOfWeek: [2, 4], // Tue, Thu
                category: 'Work',
                location: 'Office',
                recurring: true,
                createdAt: new Date().toISOString()
            }
        ];

        setTasks(sampleTasks);
        setFixedCommitments(sampleCommitments);

        // Generate initial study plan
        const { plans } = generateNewStudyPlan(sampleTasks, settings, sampleCommitments);
        setStudyPlans(plans);

        // Complete onboarding
        setShowOnboarding(false);
        localStorage.setItem('timepilot-onboarding-completed', 'true');
        setShowConfetti(true);
        setNotificationMessage('🎉 Welcome to TimePilot! Your sample schedule is ready. Try the timer and explore features!');
        setTimeout(() => setNotificationMessage(null), 5000);
    };

    const handleStartGuided = () => {
        setShowOnboarding(false);
        setShowGuidedInput(true);
    };

    const handleGuidedTaskComplete = (taskData: Omit<Task, 'id' | 'createdAt'>) => {
        // Add the task
        const newTask: Task = {
            ...taskData,
            id: Date.now().toString(),
            createdAt: new Date().toISOString()
        };

        setTasks([newTask]);
        setShowGuidedInput(false);
        localStorage.setItem('timepilot-onboarding-completed', 'true');

        // Generate study plan with the new task
        const { plans } = generateNewStudyPlan([newTask], settings, fixedCommitments);
        setStudyPlans(plans);

        setShowConfetti(true);
        setNotificationMessage('🎉 Great job! Your first task is scheduled. TimePilot found the perfect study times for you!');
        setTimeout(() => setNotificationMessage(null), 5000);
    };

    const handleBackToWelcome = () => {
        setShowGuidedInput(false);
        setShowOnboarding(true);
    };

    const handleSkipOnboarding = () => {
        setShowOnboarding(false);
        localStorage.setItem('timepilot-onboarding-completed', 'true');
        setNotificationMessage('Welcome to TimePilot! Add your first task to get started.');
        setTimeout(() => setNotificationMessage(null), 3000);
    };

    const handleInteractiveTutorialSkip = () => {
        setShowInteractiveTutorial(false);
        // Mark tutorial as completed when dismissed so the button and welcome message don't appear again
        localStorage.setItem('timepilot-interactive-tutorial-complete', 'true');
        setNotificationMessage('Tutorial dismissed. You can restart it anytime from the tutorial button in Settings.');
        setTimeout(() => setNotificationMessage(null), 3000);
    };



    // Clear highlighted tab when tutorial is not active
    useEffect(() => {
        if (!showInteractiveTutorial) {
            setHighlightedTab(null);
        }
    }, [showInteractiveTutorial]);



    const tabs = [
        { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
        { id: 'tasks', label: 'Tasks', icon: CheckSquare },
        { id: 'plan', label: 'Study Plan', icon: Calendar },
        { id: 'calendar', label: 'Calendar', icon: CalendarDays },
        { id: 'timer', label: 'Timer', icon: Clock },
        { id: 'commitments', label: 'Commitments', icon: Calendar },
        { id: 'settings', label: 'Settings', icon: SettingsIcon }
    ];

    // Use enhanced notification system for more accurate unscheduled detection
    const unscheduledTasks = getAccurateUnscheduledTasks(tasks, studyPlans, settings);
    const hasUnscheduled = shouldShowNotifications(unscheduledTasks);
    const notificationPriority = getNotificationPriority(unscheduledTasks);

    return (
        <ErrorBoundary>
                            <div className="min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
                {/* Animated background with particles */}
                <div className="fixed inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-900 dark:via-blue-900/20 dark:to-slate-900"></div>
                    <div className="absolute top-0 left-1/4 w-72 h-72 bg-blue-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob"></div>
                    <div className="absolute top-0 right-1/4 w-72 h-72 bg-indigo-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-2000"></div>
                    <div className="absolute -bottom-8 left-1/3 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-blob animation-delay-4000"></div>
                </div>

                <div className="min-h-screen relative">
                {/* Enhanced Glassmorphic Header */}
                <header className="sticky-header w-full backdrop-blur-xl bg-gradient-to-r from-white/80 via-blue-50/70 to-indigo-50/70 dark:from-gray-900/90 dark:via-blue-900/30 dark:to-indigo-900/30 shadow-xl shadow-blue-500/5 dark:shadow-blue-900/10 border-b border-gradient-to-r from-blue-200/20 via-indigo-200/20 to-purple-200/20 dark:from-blue-800/20 dark:via-indigo-800/20 dark:to-purple-800/20">
                    {/* Mobile Layout */}
                    <div className="flex sm:hidden items-center justify-between px-4 py-4">
                        <div className="flex items-center space-x-2">
                            <button
                                className={`flex items-center rounded-xl p-2 backdrop-blur-lg transition-all duration-300 z-50 border-2 ${
                                  hasUnscheduled ?
                                    notificationPriority === 'critical' ? 'bg-red-500/15 border-red-400/40 shadow-xl shadow-red-500/20 animate-pulse hover:bg-red-500/25' :
                                    notificationPriority === 'high' ? 'bg-orange-500/15 border-orange-400/40 shadow-xl shadow-orange-500/20 animate-bounce hover:bg-orange-500/25' :
                                    'bg-yellow-500/15 border-yellow-400/40 shadow-xl shadow-yellow-500/20 hover:bg-yellow-500/25'
                                  : 'bg-white/15 border-white/30 dark:bg-gray-800/20 dark:border-gray-600/30'
                                } ${
                                  hasUnscheduled ?
                                    notificationPriority === 'critical' ? 'text-red-600 dark:text-red-400' :
                                    notificationPriority === 'high' ? 'text-orange-600 dark:text-orange-400' :
                                    'text-yellow-600 dark:text-yellow-400'
                                  : 'text-gray-500 dark:text-gray-400'
                                } ${hasUnscheduled ? 'hover:scale-105 hover:shadow-2xl' : 'opacity-50 pointer-events-none cursor-not-allowed'}`}
                                title={showSuggestionsPanel ? 'Hide Study Plan Optimization' :
                                  hasUnscheduled ?
                                    `Show Study Plan Optimization (${unscheduledTasks.length} task${unscheduledTasks.length > 1 ? 's' : ''} need attention)` :
                                    'No optimization suggestions'
                                }
                                onClick={() => hasUnscheduled && setShowSuggestionsPanel(v => !v)}
                                style={{ outline: 'none', border: 'none' }}
                                disabled={!hasUnscheduled}
                            >
                                <Lightbulb className="w-4 h-4" fill={hasUnscheduled ?
                                  notificationPriority === 'critical' ? '#dc2626' :
                                  notificationPriority === 'high' ? '#ea580c' :
                                  '#fde047'
                                : 'none'} />
                            </button>
                            <button
                                className="relative p-2 backdrop-blur-lg bg-white/15 dark:bg-gray-800/20 border-2 border-white/30 dark:border-gray-600/30 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-white/25 dark:hover:bg-gray-700/30 transition-all duration-300 hover:scale-105 hover:shadow-xl"
                                onClick={() => setShowGamificationPanel(!showGamificationPanel)}
                                title="Progress & Achievements"
                            >
                                <Trophy className="w-4 h-4" />
                            </button>
                            <button
                                className="p-2 backdrop-blur-lg bg-white/15 dark:bg-gray-800/20 border-2 border-white/30 dark:border-gray-600/30 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-white/25 dark:hover:bg-gray-700/30 transition-all duration-300 hover:scale-105 hover:shadow-xl"
                                onClick={() => setShowHelpModal(true)}
                                title="Help & FAQ"
                            >
                                <HelpCircle className="w-4 h-4" />
                            </button>
                            <button
                                className={`p-2 backdrop-blur-lg border-2 rounded-xl text-gray-600 dark:text-gray-300 transition-all duration-300 hover:scale-105 hover:shadow-xl ${
                                    mobileMenuOpen
                                        ? 'bg-blue-500/20 dark:bg-blue-600/25 border-blue-400/50 dark:border-blue-500/50 text-blue-700 dark:text-blue-300'
                                        : 'bg-white/15 dark:bg-gray-800/20 border-white/30 dark:border-gray-600/30 hover:bg-white/25 dark:hover:bg-gray-700/30'
                                }`}
                                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            >
                                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="flex items-center space-x-2">
                            <div className="w-8 h-8 bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/25 transform hover:scale-105 transition-all duration-300">
                                <TimePilotIcon size={20} />
                            </div>
                            <div className="text-lg font-bold bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent drop-shadow-sm">TimePilot</div>
                        </div>
                    </div>

                    {/* Desktop Layout */}
                    <div className="hidden sm:flex items-center justify-between px-4 sm:px-6 py-6">
                        <div className="flex items-center space-x-4">
                            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-violet-500/25 transform hover:scale-105 transition-all duration-300">
                                <TimePilotIcon size={28} />
                            </div>
                            <div className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent drop-shadow-sm">TimePilot</div>
                        </div>
                        <div className="flex items-center space-x-2 sm:space-x-3 md:space-x-4">
                            <button
                                className={`flex items-center rounded-xl sm:rounded-2xl p-2 sm:p-3 backdrop-blur-lg transition-all duration-300 z-50 border-2 ${
                                  hasUnscheduled ?
                                    notificationPriority === 'critical' ? 'bg-red-500/15 border-red-400/40 shadow-xl shadow-red-500/20 animate-pulse hover:bg-red-500/25' :
                                    notificationPriority === 'high' ? 'bg-orange-500/15 border-orange-400/40 shadow-xl shadow-orange-500/20 animate-bounce hover:bg-orange-500/25' :
                                    'bg-yellow-500/15 border-yellow-400/40 shadow-xl shadow-yellow-500/20 hover:bg-yellow-500/25'
                                  : 'bg-white/15 border-white/30 dark:bg-gray-800/20 dark:border-gray-600/30'
                                } ${
                                  hasUnscheduled ?
                                    notificationPriority === 'critical' ? 'text-red-600 dark:text-red-400' :
                                    notificationPriority === 'high' ? 'text-orange-600 dark:text-orange-400' :
                                    'text-yellow-600 dark:text-yellow-400'
                                  : 'text-gray-500 dark:text-gray-400'
                                } ${hasUnscheduled ? 'hover:scale-105 hover:shadow-2xl' : 'opacity-50 pointer-events-none cursor-not-allowed'}`}
                                title={showSuggestionsPanel ? 'Hide Study Plan Optimization' :
                                  hasUnscheduled ?
                                    `Show Study Plan Optimization (${unscheduledTasks.length} task${unscheduledTasks.length > 1 ? 's' : ''} need attention)` :
                                    'No optimization suggestions'
                                }
                                onClick={() => hasUnscheduled && setShowSuggestionsPanel(v => !v)}
                                style={{ outline: 'none', border: 'none' }}
                                disabled={!hasUnscheduled}
                            >
                                <Lightbulb className={`w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6`} fill={hasUnscheduled ?
                                  notificationPriority === 'critical' ? '#dc2626' :
                                  notificationPriority === 'high' ? '#ea580c' :
                                  '#fde047'
                                : 'none'} />
                            </button>
                            <button
                                className="relative p-2 sm:p-3 backdrop-blur-lg bg-white/15 dark:bg-gray-800/20 border-2 border-white/30 dark:border-gray-600/30 rounded-xl sm:rounded-2xl text-gray-600 dark:text-gray-300 hover:bg-white/25 dark:hover:bg-gray-700/30 transition-all duration-300 hover:scale-105 hover:shadow-xl"
                                onClick={() => setShowGamificationPanel(!showGamificationPanel)}
                                title="Progress & Achievements"
                            >
                                <Trophy className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                            <button
                                className="p-2 sm:p-3 backdrop-blur-lg bg-white/15 dark:bg-gray-800/20 border-2 border-white/30 dark:border-gray-600/30 rounded-xl sm:rounded-2xl text-gray-600 dark:text-gray-300 hover:bg-white/25 dark:hover:bg-gray-700/30 transition-all duration-300 hover:scale-105 hover:shadow-xl"
                                onClick={() => setShowHelpModal(true)}
                                title="Help & FAQ"
                            >
                                <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                            <button
                                className={`lg:hidden p-2 sm:p-3 backdrop-blur-lg border-2 rounded-xl sm:rounded-2xl text-gray-600 dark:text-gray-300 transition-all duration-300 hover:scale-105 hover:shadow-xl ${
                                    mobileMenuOpen
                                        ? 'bg-blue-500/20 dark:bg-blue-600/25 border-blue-400/50 dark:border-blue-500/50 text-blue-700 dark:text-blue-300'
                                        : 'bg-white/15 dark:bg-gray-800/20 border-white/30 dark:border-gray-600/30 hover:bg-white/25 dark:hover:bg-gray-700/30'
                                }`}
                                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                            >
                                {mobileMenuOpen ? <X className="w-5 h-5 sm:w-6 sm:h-6" /> : <Menu className="w-5 h-5 sm:w-6 sm:h-6" />}
                            </button>
                        </div>
                    </div>
                </header>

                {/* Enhanced Navigation */}
                <nav className="sticky-nav backdrop-blur-xl bg-gradient-to-r from-white/90 via-blue-50/85 to-indigo-50/85 dark:from-gray-900/95 dark:via-blue-900/25 dark:to-indigo-900/25 shadow-2xl shadow-blue-500/8 dark:shadow-blue-900/15 border-b border-gradient-to-r from-blue-200/15 via-indigo-200/15 to-purple-200/15 dark:from-blue-800/15 dark:via-indigo-800/15 dark:to-purple-800/15">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                        {/* Desktop Navigation */}
                        <div className="hidden lg:flex items-center justify-center space-x-1 py-4">
                            <div className="flex items-center bg-gradient-to-r from-blue-100/80 via-indigo-100/80 to-purple-100/80 dark:from-gray-800/80 dark:via-blue-900/40 dark:to-indigo-900/40 rounded-2xl p-1.5 shadow-inner border border-blue-200/50 dark:border-blue-800/50">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => {
                                            setActiveTab(tab.id as typeof activeTab);
                                            setMobileMenuOpen(false);
                                        }}
                                        className={`flex items-center justify-center px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 relative group ${
                                            activeTab === tab.id
                                                ? 'bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 text-white shadow-lg shadow-blue-500/30 transform scale-105'
                                                : 'text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white/80 dark:hover:bg-gray-700/60 hover:shadow-md hover:scale-102'
                                        } ${showInteractiveTutorial && highlightedTab === tab.id ? 'ring-2 ring-yellow-400 animate-pulse' : ''}`}
                                        title={tab.label}
                                    >
                                        <tab.icon size={18} className={activeTab === tab.id ? 'drop-shadow-sm' : 'group-hover:scale-110 transition-transform'} />
                                        {activeTab === tab.id && (
                                            <span className="ml-2.5 hidden sm:inline drop-shadow-sm">{tab.label}</span>
                                        )}
                                        {activeTab !== tab.id && (
                                            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-400/0 via-indigo-400/0 to-purple-400/0 group-hover:from-blue-400/10 group-hover:via-indigo-400/10 group-hover:to-purple-400/10 transition-all duration-300"></div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Mobile Navigation */}
                        <div className={`lg:hidden ${mobileMenuOpen ? 'block' : 'hidden'}`}>
                            <div className="py-4">
                                <div className="flex flex-wrap items-center justify-center gap-2 bg-gradient-to-r from-blue-100/80 via-indigo-100/80 to-purple-100/80 dark:from-gray-800/80 dark:via-blue-900/40 dark:to-indigo-900/40 rounded-2xl p-3 shadow-inner border border-blue-200/50 dark:border-blue-800/50 max-w-full overflow-x-auto">
                                    {tabs.map((tab) => (
                                        <button
                                            key={tab.id}
                                            onClick={() => {
                                                setActiveTab(tab.id as typeof activeTab);
                                                setMobileMenuOpen(false);
                                            }}
                                            className={`flex items-center justify-center px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-300 group min-w-max ${
                                                activeTab === tab.id
                                                    ? 'bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 text-white shadow-lg shadow-blue-500/30 transform scale-105'
                                                    : 'text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white/80 dark:hover:bg-gray-700/60 hover:shadow-md hover:scale-102'
                                            } ${showInteractiveTutorial && highlightedTab === tab.id ? 'ring-2 ring-yellow-400 animate-pulse' : ''}`}
                                        >
                                            <tab.icon size={16} className={activeTab === tab.id ? 'drop-shadow-sm' : 'group-hover:scale-110 transition-transform'} />
                                            <span className={`ml-1.5 ${activeTab === tab.id ? 'drop-shadow-sm' : ''}`}>{tab.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </nav>

                {/* Main Content */}
                <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 relative overflow-x-auto">
                    {/* Toggle Suggestions Panel Button */}
                    {/* Suggestions Panel */}
                    {showSuggestionsPanel && hasUnscheduled && (
                        <SuggestionsPanel 
                            tasks={tasks}
                            studyPlans={studyPlans}
                            settings={settings}
                            fixedCommitments={fixedCommitments}
                            // Removed suggestions prop
                            onUpdateSettings={handleUpdateSettingsFromSuggestions}
                        />
                    )}
                    {notificationMessage && (
                        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-sm sm:max-w-md lg:max-w-2xl px-4">
                            {notificationMessage.includes("can't be added due to schedule conflicts") ? (
                                // Enhanced notification for task addition conflicts
                                <div className="backdrop-blur-md bg-white/80 dark:bg-black/40 border border-orange-200/50 dark:border-orange-500/30 rounded-2xl shadow-2xl shadow-orange-500/20">
                                    <div className="p-6 sm:p-8">
                                        <div className="flex items-start space-x-4">
                                            <div className="flex-shrink-0">
                                                <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-red-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/25">
                                                    <svg className="w-5 h-5 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                                    </svg>
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white mb-2">
                                                    Task Cannot Be Added
                                                </h3>
                                                <div className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                                                    <p className="mb-3">
                                                        The task <span className="font-medium text-gray-900 dark:text-white">"{notificationMessage.match(/Task "([^"]+)"/)?.[1] || 'Unknown'}"</span> cannot be scheduled with your current settings.
                                                    </p>
                                                    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3 sm:p-4">
                                                        <h4 className="font-medium text-orange-800 dark:text-orange-200 mb-2">Try these solutions:</h4>
                                                        <ul className="space-y-1 text-sm text-orange-700 dark:text-orange-300">
                                                            <li className="flex items-start space-x-2">
                                                                <span className="text-orange-500 dark:text-orange-400 mt-0.5"></span>
                                                                <span>Reduce the estimated hours for this task</span>
                                                            </li>
                                                            <li className="flex items-start space-x-2">
                                                                <span className="text-orange-500 dark:text-orange-400 mt-0.5"></span>
                                                                <span>Adjust the deadline to allow more time</span>
                                                            </li>
                                                            <li className="flex items-start space-x-2">
                                                                <span className="text-orange-500 dark:text-orange-400 mt-0.5"></span>
                                                                <span>Increase your daily available study hours in Settings</span>
                                                            </li>
                                                            <li className="flex items-start space-x-2">
                                                                <span className="text-orange-500 dark:text-orange-400 mt-0.5"></span>
                                                                <span>Remove or reschedule other tasks</span>
                                                            </li>
                                                        </ul>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
                                                    <button
                                                        onClick={() => setActiveTab('settings')}
                                                        className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-sm font-medium"
                                                    >
                                                        Open Settings
                                                    </button>
                                                    <button
                                                        onClick={() => setNotificationMessage(null)}
                                                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                                                    >
                                                        Dismiss
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                // Default notification for other messages
                                <div className={`px-4 sm:px-6 py-3 rounded-lg shadow-lg flex items-center space-x-4 ${
                                    notificationMessage.includes('successfully') 
                                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                                }`}>
                                    <span className="text-sm">{notificationMessage}</span>
                                    <button 
                                        onClick={() => setNotificationMessage(null)} 
                                        className="text-current hover:opacity-75 font-bold"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'dashboard' && !showOnboarding && (
                        <Dashboard
                            tasks={tasks}
                            studyPlans={studyPlans}
                            dailyAvailableHours={settings.dailyAvailableHours}
                            workDays={settings.workDays}
                            onSelectTask={handleSelectTask}
                            onGenerateStudyPlan={handleGenerateStudyPlan}
                            hasCompletedTutorial={localStorage.getItem('timepilot-interactive-tutorial-complete') === 'true'}
                            habits={habits}
                            onAddHabit={handleAddHabit}
                            onToggleHabitToday={handleToggleHabitToday}
                            onDeleteHabit={handleDeleteHabit}
                        />
                    )}
                    {showOnboarding && (
                        <WelcomeOnboarding
                            onCreateSampleSchedule={handleCreateSampleSchedule}
                            onStartGuided={handleStartGuided}
                            onSkipOnboarding={handleSkipOnboarding}
                            settings={settings}
                        />
                    )}
                    {showGuidedInput && (
                        <GuidedTaskInput
                            onAddTask={handleGuidedTaskComplete}
                            onBack={handleBackToWelcome}
                            settings={settings}
                        />
                    )}

                    {/* Celebration Confetti */}
                    <Confetti
                        show={showConfetti}
                        onComplete={() => setShowConfetti(false)}
                    />

                    {activeTab === 'tasks' && (
                        <div className="space-y-4 sm:space-y-6">
                            <button
                                className="w-full sm:w-auto bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 flex items-center justify-center sm:justify-start space-x-2 mb-2"
                                onClick={() => setShowTaskInput(true)}
                            >
                                + Add Task
                            </button>
                                    {showTaskInput && (
          <TaskInput onAddTask={handleAddTask} onCancel={() => setShowTaskInput(false)} userSettings={settings} existingStudyPlans={studyPlans} fixedCommitments={fixedCommitments} />
                            )}
                            <TaskList
                                tasks={tasks}
                                onUpdateTask={handleUpdateTask}
                                onDeleteTask={handleDeleteTask}
                                autoRemovedTasks={autoRemovedTasks}
                                onDismissAutoRemovedTask={handleDismissAutoRemovedTask}
                                userSettings={settings}
                            />
                        </div>
                    )}

                    {activeTab === 'plan' && (
                        <StudyPlanView
                            studyPlans={studyPlans}
                            tasks={tasks}
                            fixedCommitments={fixedCommitments}
                            onSelectTask={handleSelectTask}
                            onSelectCommitment={handleSelectCommitment}
                            onGenerateStudyPlan={handleGenerateStudyPlan}
                            onUndoSessionDone={handleUndoSessionDone}
                            onSkipSession={handleSkipSession}
                            settings={settings}
                            onAddFixedCommitment={handleAddFixedCommitment}
                            onRefreshStudyPlan={handleRefreshStudyPlan}
                            onUpdateTask={handleUpdateTask}
                            onSkipCommitment={handleSkipCommitment}
                        />
                    )}

                    {activeTab === 'calendar' && (
                        <CalendarView
                            studyPlans={studyPlans}
                            fixedCommitments={fixedCommitments}
                            tasks={tasks}
                            settings={settings}
                            onSelectTask={handleSelectTask}
                            onSelectCommitment={handleSelectCommitment}
                            onStartManualSession={(commitment, durationSeconds) => {
                                // First, ensure any running timer is stopped to prevent race conditions
                                setGlobalTimer(prev => ({
                                    ...prev,
                                    isRunning: false,
                                    startTime: undefined,
                                    pausedTime: undefined,
                                    lastUpdateTime: undefined
                                }));

                                // Set the current commitment to distinguish from tasks
                                setCurrentCommitment(commitment);
                                setCurrentTask({
                                    id: commitment.id,
                                    title: commitment.title,
                                    estimatedHours: durationSeconds / 3600,
                                    status: 'pending',
                                    importance: false,
                                    deadline: '',
                                    createdAt: commitment.createdAt,
                                    description: commitment.description || '',
                                    category: commitment.category,
                                });
                                setCurrentSession({
                                    allocatedHours: Number(durationSeconds) / 3600
                                    // Don't set planDate and sessionNumber for commitments
                                });
                                setActiveTab('timer');

                                // Use setTimeout to ensure the timer state is reset after the current execution cycle
                                setTimeout(() => {
                                    setGlobalTimer({
                                        isRunning: false,
                                        currentTime: durationSeconds,
                                        totalTime: durationSeconds,
                                        currentTaskId: commitment.id,
                                        startTime: undefined,
                                        pausedTime: undefined,
                                        lastUpdateTime: undefined
                                    });
                                }, 0);
                            }}
                            onDeleteFixedCommitment={handleDeleteCommitment}
                            onUpdateCommitment={handleUpdateFixedCommitment}
                            onUpdateStudyPlans={setStudyPlans}
                        />
                    )}

                    {activeTab === 'timer' && currentTask ? (
                        <StudyTimer
                            currentTask={currentTask}
                            currentSession={currentSession}
                            onTimerComplete={handleMarkSessionDoneFromTimer}
                            planDate={currentSession?.planDate}
                            sessionNumber={currentSession?.sessionNumber}
                            onMarkSessionDone={handleMarkSessionDone}
                            timer={globalTimer}
                            onTimerStart={handleTimerStart}
                            onTimerPause={handleTimerPause}
                            onTimerStop={handleTimerStop}
                            onTimerReset={handleTimerReset}
                            onTimerSpeedUp={handleTimerSpeedUp}
                            onTimerUpdateTime={handleTimerUpdateTime}
                            onContinueWithNextSession={handleContinueWithNextSession}
                            onTakeBreak={handleTakeBreak}
                            onReviewCompletedWork={handleReviewCompletedWork}
                            studyPlans={studyPlans}
                            tasks={tasks}
                        />
                    ) : activeTab === 'timer' && !currentTask ? (
                        <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 text-center dark:bg-gray-900 dark:shadow-gray-900">
                            <h2 className="text-lg sm:text-xl font-semibold text-gray-800 mb-4 dark:text-white">Study Timer</h2>
                            <p className="text-gray-500 dark:text-gray-300">Select a task to start studying</p>
                        </div>
                    ) : null}

                    {activeTab === 'commitments' && (
                        <div className="space-y-4 sm:space-y-6">
                            <FixedCommitmentInput
                                onAddCommitment={handleAddFixedCommitment}
                                existingCommitments={fixedCommitments}
                                settings={settings}
                                existingPlans={studyPlans}
                            />
                            {editingCommitment ? (
                                <FixedCommitmentEdit
                                    commitment={editingCommitment}
                                    existingCommitments={fixedCommitments}
                                    onUpdateCommitment={handleUpdateFixedCommitment}
                                    onCancel={() => setEditingCommitment(null)}
                                />
                            ) : (
                                <CommitmentsList
                                    commitments={fixedCommitments}
                                    onEditCommitment={setEditingCommitment}
                                    onDeleteCommitment={handleDeleteCommitment}
                                />
                            )}
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 dark:bg-gray-900 dark:shadow-gray-900">
                            <Settings
                                settings={settings}
                                onUpdateSettings={handleUpdateSettings}
                                                        darkMode={darkMode}
                        onToggleDarkMode={handleToggleDarkMode}
                                onRestartTutorial={handleRestartTutorial}
                                hasTasks={tasks.length > 0}
                                highlightStudyPlanMode={highlightStudyPlanMode}
                                studyPlans={studyPlans}
                                canChangeSetting={canChangeSetting}
                            />
                        </div>
                    )}
                </main>

                {/* Help Modal */}
                {showHelpModal && (
                    <div 
                        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
                        onClick={() => setShowHelpModal(false)}
                    >
                        <div 
                            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                                        <HelpCircle className="text-blue-600 dark:text-blue-400" size={28} />
                                        <span>Help & FAQ</span>
                                    </h2>
                                    <button
                                        onClick={() => setShowHelpModal(false)}
                                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                    >
                                        <X size={24} />
                                    </button>
                                </div>

                                <div className="space-y-6">
                                    {/* Getting Started Section */}
                                    <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
                                        <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-200 mb-2"> Getting Started</h3>
                                        <ol className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                                            <li>1. Add your tasks with deadlines and time estimates</li>
                                            <li>2. Set your fixed commitments (classes, work, etc.)</li>
                                            <li>3. Configure your study preferences in Settings</li>
                                            <li>4. Generate your first study plan</li>
                                            <li>5. Start using the timer to track your progress</li>
                                        </ol>
                                    </div>

                                    <div className="space-y-4">
                                        {/* Core Concepts */}
                                        <details className="group border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <summary className="flex items-center justify-between cursor-pointer p-4 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100">
                                                <span>What's the difference between Tasks and Commitments?</span>
                                                <svg className="w-4 h-4 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </summary>
                                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-3">
                                                    <div>
                                                        <strong className="text-green-600 dark:text-green-400">Tasks</strong> are study activities that need to be completed:
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> Have deadlines and estimated hours</li>
                                                            <li> Are broken into study sessions by TimePilot</li>
                                                            <li> Can be marked as important/urgent for prioritization</li>
                                                            <li> Examples: "Math assignment", "Read chapter 5", "Prepare presentation"</li>
                                                        </ul>
                                                    </div>
                                                    <div>
                                                        <strong className="text-blue-600 dark:text-blue-400">Commitments</strong> are fixed time blocks that cannot be moved:
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> Block time in your schedule (classes, work, appointments)</li>
                                                            <li> TimePilot schedules study sessions around them</li>
                                                            <li> Can be recurring (every Monday) or one-time events</li>
                                                            <li> Examples: "Chemistry class", "Work shift", "Doctor appointment"</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>
                                        </details>

                                        <details className="group border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <summary className="flex items-center justify-between cursor-pointer p-4 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100">
                                                <span>How does smart scheduling work?</span>
                                                <svg className="w-4 h-4 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </summary>
                                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-3">
                                                    <p><strong>Scheduling starts from today onwards</strong> - TimePilot only schedules sessions from the current day forward, never in the past.</p>
                                                    <p>The intelligent scheduling process:</p>
                                                    <ol className="ml-4 space-y-1">
                                                        <li>1. <strong>Analyzes your commitments</strong> to find available time slots</li>
                                                        <li>2. <strong>Prioritizes tasks</strong> based on importance and urgency (deadlines)</li>
                                                        <li>3. <strong>Distributes study hours</strong> across available days until each task's deadline</li>
                                                        <li>4. <strong>Respects your preferences</strong> like daily study limits, work days, and minimum session lengths</li>
                                                        <li>5. <strong>Avoids conflicts</strong> by never scheduling over existing commitments</li>
                                                    </ol>
                                                    <p className="bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded border-l-4 border-yellow-400">
                                                        <strong>Important:</strong> Sessions are only scheduled within your study window and on your selected work days!
                                                    </p>
                                                </div>
                                            </div>
                                        </details>

                                        <details className="group border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <summary className="flex items-center justify-between cursor-pointer p-4 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100">
                                                <span>How does session rescheduling work?</span>
                                                <svg className="w-4 h-4 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </summary>
                                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-3">
                                                    <div>
                                                        <strong className="text-blue-600 dark:text-blue-400">Rescheduled Sessions:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> Drag and drop sessions to new time slots in the calendar</li>
                                                            <li> TimePilot checks for conflicts and validates the new time</li>
                                                            <li> Reschedule history is tracked for each session</li>
                                                            <li> You can reschedule as many times as needed</li>
                                                        </ul>
                                                    </div>
                                                    <div>
                                                        <strong className="text-purple-600 dark:text-purple-400">Skipped Sessions:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> Use the "Skip Session" button to intentionally skip a session</li>
                                                            <li> Skipped sessions are removed from your schedule and don't count toward task completion</li>
                                                            <li> Helpful when you realize you don't need all the scheduled hours</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>
                                        </details>

                                        {/* Settings Features */}
                                        <details className="group border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <summary className="flex items-center justify-between cursor-pointer p-4 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100">
                                                <span>Settings & Customization Features</span>
                                                <svg className="w-4 h-4 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </summary>
                                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-4">
                                                    <div>
                                                        <strong className="text-blue-600 dark:text-blue-400">Study Plan Mode:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> <strong>Even:</strong> Distributes study hours evenly across available days</li>
                                                            <li> <strong>Eisenhower:</strong> Front-loads important tasks closer to deadlines</li>
                                                            <li> <strong>Balanced:</strong> Mixes both approaches for optimal results</li>
                                                        </ul>
                                                    </div>
                                                    <div>
                                                        <strong className="text-green-600 dark:text-green-400">Time Management:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> <strong>Daily Available Hours:</strong> How many hours you can study per day</li>
                                                            <li> <strong>Study Window:</strong> Earliest and latest times you want to study</li>
                                                            <li> <strong>Work Days:</strong> Which days of the week you want to study</li>
                                                            <li> <strong>Buffer Days:</strong> Complete tasks this many days before deadline</li>
                                                        </ul>
                                                    </div>
                                                    <div>
                                                        <strong className="text-purple-600 dark:text-purple-400">Session Settings:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> <strong>Minimum Session Length:</strong> Shortest study session (prevents tiny sessions)</li>
                                                            <li> <strong>Buffer Time:</strong> Rest time between back-to-back sessions</li>
                                                        </ul>
                                                    </div>
                                                    <div>
                                                        <strong className="text-orange-600 dark:text-orange-400">Advanced:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> <strong>Dark Mode:</strong> Toggle between light and dark themes</li>
                                                            <li> <strong>Auto-complete Sessions:</strong> Automatically mark timer sessions as complete</li>
                                                            <li> <strong>Notifications:</strong> Enable study reminders (browser notifications)</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>
                                        </details>

                                        <details className="group border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <summary className="flex items-center justify-between cursor-pointer p-4 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100">
                                                <span>How accurate are the time estimates?</span>
                                                <svg className="w-4 h-4 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </summary>
                                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                                                    <p>TimePilot includes an <strong>Estimation Helper</strong> to help you make accurate time estimates:</p>
                                                    <ul className="ml-4 space-y-1">
                                                        <li> Choose task types (Writing, Learning, Research, etc.)</li>
                                                        <li> Select complexity levels and difficulty factors</li>
                                                        <li> Get personalized time estimates based on your input</li>
                                                        <li> Learn from actual completion times to improve future estimates</li>
                                                    </ul>
                                                    <p className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded border-l-4 border-blue-400">
                                                        <strong>Tip:</strong> Start with conservative estimates and adjust based on your actual completion times. Better to overestimate than scramble at the last minute!
                                                    </p>
                                                </div>
                                            </div>
                                        </details>

                                        <details className="group border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <summary className="flex items-center justify-between cursor-pointer p-4 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100">
                                                <span>What makes TimePilot different?</span>
                                                <svg className="w-4 h-4 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </summary>
                                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                                                    <p>TimePilot goes beyond simple to-do lists and basic calendars:</p>
                                                    <ul className="ml-4 space-y-1">
                                                        <li> <strong>Intelligent conflict avoidance:</strong> Never schedules study time over commitments</li>
                                                        <li> <strong>Flexible rescheduling:</strong> Drag and drop sessions to fit your changing schedule</li>
                                                        <li> <strong>Priority-based scheduling:</strong> Important and urgent tasks get scheduled first</li>
                                                        <li> <strong>Deadline awareness:</strong> Ensures tasks are completed before their deadlines</li>
                                                        <li> <strong>Adaptive learning:</strong> Improves estimates based on your actual completion patterns</li>
                                                        <li> <strong>Real-time optimization:</strong> Provides suggestions to improve your study schedule</li>
                                                        <li> <strong>Comprehensive tracking:</strong> Monitors progress across all tasks and sessions</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </details>

                                        <details className="group border border-gray-200 dark:border-gray-700 rounded-lg">
                                            <summary className="flex items-center justify-between cursor-pointer p-4 text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-200 dark:hover:text-gray-100">
                                                <span>Tips for getting the most out of TimePilot</span>
                                                <svg className="w-4 h-4 transform group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </summary>
                                            <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-3">
                                                    <div>
                                                        <strong className="text-green-600 dark:text-green-400">Setting Up:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> Add all your fixed commitments first (classes, work, recurring appointments)</li>
                                                            <li> Be realistic about your daily available hours and study window</li>
                                                            <li> Mark truly important tasks as "Important" for better prioritization</li>
                                                        </ul>
                                                    </div>
                                                    <div>
                                                        <strong className="text-blue-600 dark:text-blue-400">Daily Usage:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> Check your schedule each morning and adjust if needed</li>
                                                            <li> Use the timer to track actual study time</li>
                                                            <li> Mark sessions as complete or missed accurately</li>
                                                            <li> Regenerate your plan if you add new tasks or commitments</li>
                                                        </ul>
                                                    </div>
                                                    <div>
                                                        <strong className="text-purple-600 dark:text-purple-400">Optimization:</strong>
                                                        <ul className="ml-4 mt-1 space-y-1">
                                                            <li> Review the Suggestions panel for schedule improvements</li>
                                                            <li> Adjust time estimates based on your completion patterns</li>
                                                            <li> Experiment with different Study Plan Modes to find what works best</li>
                                                            <li> Use the Progress Dashboard to track your productivity trends</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>
                                        </details>
                                    </div>

                                    {/* Support Section */}
                                    <div className="pt-6 border-t border-gray-200 dark:border-gray-700">
                                        <div className="text-center space-y-4">
                                            <div className="flex items-center justify-center space-x-2">
                                                <span className="text-2xl"></span>
                                                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Support TimePilot</h3>
                                                <span className="text-2xl"></span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                                If TimePilot has helped you manage your time better, consider supporting its development!
                                            </p>
                                            <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                                <button
                                                    onClick={() => setShowGCashModal(true)}
                                                    className="flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg hover:from-green-600 hover:to-emerald-600 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
                                                >
                                                    <span className="text-lg"></span>
                                                    <span>GCash</span>
                                                </button>
                                                <button
                                                    onClick={() => window.open('https://paypal.me/yourusername', '_blank')}
                                                    className="flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
                                                >
                                                    <span className="text-lg"></span>
                                                    <span>PayPal</span>
                                                </button>
                                                <button
                                                    onClick={() => window.open('https://ko-fi.com/yourusername', '_blank')}
                                                    className="flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all duration-200 font-medium shadow-lg hover:shadow-xl"
                                                >
                                                    <span className="text-lg"></span>
                                                    <span>Ko-fi</span>
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                Your support helps keep TimePilot free and enables new features!
                                            </p>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <button
                                            onClick={() => setShowHelpModal(false)}
                                            className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                                        >
                                            Got it!
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* GCash Donation Modal */}
                {showGCashModal && (
                    <div 
                        className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
                        onClick={() => setShowGCashModal(false)}
                    >
                        <div 
                            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-6">
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-xl font-bold text-gray-800 dark:text-white flex items-center space-x-2">
                                        <span className="text-2xl"></span>
                                        <span>Support via GCash</span>
                                    </h2>
                                    <button
                                        onClick={() => setShowGCashModal(false)}
                                        className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                    >
                                        <X size={24} />
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    {/* Motivational Message */}
                                    <div className="text-center space-y-2">
                                        <div className="text-3xl mb-1"></div>
                                        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
                                            Help TimePilot Soar Higher!
                                        </h3>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            Your support helps keep TimePilot free and enables amazing new features for everyone.
                                        </p>
                                    </div>

                                    {/* GCash QR Code Display */}
                                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-700 rounded-lg p-3">
                                        <div className="text-center space-y-2">
                                            <div className="flex items-center justify-center space-x-2">
                                                <span className="text-lg"></span>
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Scan GCash QR Code</span>
                                            </div>
                                            <div className="bg-white dark:bg-gray-700 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
                                                <img 
                                                    src="/gcash-qr.png" 
                                                    alt="GCash QR Code" 
                                                    className="w-40 h-40 mx-auto rounded-lg shadow-lg"
                                                    style={{ 
                                                        maxWidth: '100%', 
                                                        height: 'auto',
                                                        objectFit: 'contain'
                                                    }}
                                                />
                                            </div>
                                            <div className="text-xs text-gray-600 dark:text-gray-400">
                                                Open GCash app  Scan QR  Send any amount
                                            </div>
                                        </div>
                                    </div>

                                    {/* Suggested Amounts */}
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 text-center">
                                            Suggested Amounts (Any amount is appreciated!)
                                        </h4>
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { amount: '50', emoji: '☕', desc: 'Coffee' },
                                                { amount: '100', emoji: '🍕', desc: 'Pizza' },
                                                { amount: '200', emoji: '🎉', desc: 'Party' }
                                            ].map((item, index) => (
                                                <div
                                                    key={index}
                                                    className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-center border border-gray-200 dark:border-gray-600 hover:border-green-300 dark:hover:border-green-600 transition-colors cursor-pointer"
                                                    onClick={() => {
                                                        // Show success message for QR scan
                                                        setNotificationMessage(` Scan the QR code above with GCash app  Send ${item.amount} for ${item.desc} `);
                                                        setShowGCashModal(false);
                                                    }}
                                                >
                                                    <div className="text-lg mb-1">{item.emoji}</div>
                                                    <div className="text-sm font-semibold text-gray-800 dark:text-white">{item.amount}</div>
                                                    <div className="text-xs text-gray-600 dark:text-gray-400">{item.desc}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Benefits List */}
                                    <div className="space-y-1">
                                        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Your support enables:
                                        </h4>
                                        <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                                            <div className="flex items-center space-x-2">
                                                <span className="text-green-500">���</span>
                                                <span>New features and improvements</span>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <span className="text-green-500">✅</span>
                                                <span>Keep TimePilot free for everyone</span>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <span className="text-green-500">���</span>
                                                <span>Better performance and reliability</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Thank You Message */}
                                    <div className="text-center pt-3 border-t border-gray-200 dark:border-gray-700">
                                        <p className="text-sm text-gray-500 dark:text-gray-400">
                                            Thank you for supporting TimePilot! 
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Interactive Tutorial */}
                {showInteractiveTutorial && (
                    <InteractiveTutorial
                        isActive={showInteractiveTutorial}
                        onComplete={handleInteractiveTutorialComplete}
                        onSkip={handleInteractiveTutorialSkip}
                        currentTab={activeTab}
                        onTabChange={setActiveTab}
                        tasksCount={tasks.length}
                        commitmentsCount={fixedCommitments.length}
                        onHighlightTab={setHighlightedTab}
                        onHighlightStudyPlanMode={setHighlightStudyPlanMode}
                        currentStudyPlanMode={settings.studyPlanMode}
                        hasActiveTimerSession={!!currentTask}
                    />
                )}

                {/* Tutorial Button */}
                <TutorialButton
                    onStartTutorial={handleStartTutorial}
                    hasCompletedTutorial={localStorage.getItem('timepilot-interactive-tutorial-complete') === 'true'}
                    hasTasks={tasks.length > 0}
                    isTutorialActive={showInteractiveTutorial}
                    hasCompletedOnboarding={localStorage.getItem('timepilot-onboarding-completed') === 'true'}
                />

                {/* Gamification Panel */}
                {showGamificationPanel && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <div className="max-w-4xl w-full max-h-[90vh] overflow-hidden">
                            <GamificationPanel
                                gamificationData={gamificationData}
                                onClosePanel={() => setShowGamificationPanel(false)}
                            />
                        </div>
                    </div>
                )}

                {/* Achievement Notification */}
                {achievementNotification && (
                    <AchievementNotification
                        achievement={achievementNotification}
                        onDismiss={() => setAchievementNotification(null)}
                    />
                )}

                {/* Motivational Toast */}
                {motivationalToast && (
                    <MotivationalToast
                        message={motivationalToast.message}
                        icon={motivationalToast.icon}
                        type={motivationalToast.type}
                        onDismiss={() => setMotivationalToast(null)}
                    />
                )}

                <PWAInstallPrompt />

            </div>
        </div>
        </ErrorBoundary>
    );
}

export default App;
