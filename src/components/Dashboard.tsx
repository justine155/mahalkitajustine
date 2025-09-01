import React, { useState, useMemo } from 'react';
import { Clock, BookOpen, TrendingUp, Calendar, Bell, CheckCircle2, AlertTriangle, Clock3, X } from 'lucide-react';
import { Task, StudyPlan } from '../types';
import { formatTime, getLocalDateString, checkSessionStatus } from '../utils/scheduling';
import SafePieChart from './SafePieChart';
import HabitTracker from './HabitTracker';
import { Habit } from '../types';
import EnvironmentCard from './EnvironmentCard';

interface DashboardProps {
  tasks: Task[];
  studyPlans: StudyPlan[];
  dailyAvailableHours: number;
  workDays: number[];
  onSelectTask: (task: Task, session?: { allocatedHours: number; planDate?: string; sessionNumber?: number }) => void;
  onGenerateStudyPlan?: () => void;
  hasCompletedTutorial?: boolean;
  habits: Habit[];
  onAddHabit: (habit: { title: string; cadence: 'daily' | 'weekly'; targetPerWeek?: number; reminder?: boolean }) => void;
  onToggleHabitToday: (id: string) => void;
  onDeleteHabit: (id: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ tasks, studyPlans, dailyAvailableHours, workDays, onSelectTask, onGenerateStudyPlan, habits, onAddHabit, onToggleHabitToday, onDeleteHabit }) => {
  const [showRegeneratePrompt, setShowRegeneratePrompt] = useState(true);
  const [analyticsFilter, setAnalyticsFilter] = useState<'all' | 'week' | 'month' | 'custom'>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Helper to get start/end of week/month
  const todayDate = new Date();
  const startOfWeek = new Date(todayDate);
  startOfWeek.setDate(todayDate.getDate() - todayDate.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  const startOfMonth = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const endOfMonth = new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0);

  // Filter studyPlans by selected period
  let filteredPlans = studyPlans;
  if (analyticsFilter === 'week') {
    filteredPlans = studyPlans.filter(plan => {
      const d = new Date(plan.date);
      return d >= startOfWeek && d <= endOfWeek;
    });
  } else if (analyticsFilter === 'month') {
    filteredPlans = studyPlans.filter(plan => {
      const d = new Date(plan.date);
      return d >= startOfMonth && d <= endOfMonth;
    });
  } else if (analyticsFilter === 'custom' && customStart && customEnd) {
    const start = new Date(customStart);
    const end = new Date(customEnd);
    filteredPlans = studyPlans.filter(plan => {
      const d = new Date(plan.date);
      return d >= start && d <= end;
    });
  }

  // Recalculate stats for filtered period
  const completedTasks = tasks.filter(task => task.status === 'completed');
  const pendingTasks = tasks.filter(task => task.status === 'pending');
  const totalEstimatedHours = pendingTasks.reduce((sum, task) => sum + task.estimatedHours, 0);
  
  // Calculate completed hours from ALL done sessions (not just filtered ones)
  const completedHours = studyPlans.reduce((planSum, plan) => 
    planSum + plan.plannedTasks
      .filter(session => session.done || session.status === 'completed')
      .reduce((sessionSum, session) => sessionSum + (session.actualHours || session.allocatedHours), 0), 
    0
  );
  
  // Calculate total original estimated hours from all tasks (both completed and pending)
  const totalOriginalEstimatedHours = tasks.reduce((sum, task) => {
    // For completed tasks, we need to get their original estimated hours
    // For pending tasks, use their current estimated hours
    if (task.status === 'completed') {
      // For completed tasks, get the sum of all their sessions (completed + skipped)
      const taskSessions = studyPlans.flatMap(plan => plan.plannedTasks).filter(s => s.taskId === task.id);
      const taskOriginalHours = taskSessions.reduce((sum, session) => sum + session.allocatedHours, 0);
      return sum + taskOriginalHours;
    } else {
      return sum + task.estimatedHours;
    }
  }, 0);

  // Urgent tasks for all pending tasks
  const urgentTasks = pendingTasks
    .filter(task => {
      const deadline = new Date(task.deadline);
      const now = new Date();
      const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntilDeadline <= 3;
    })
    .sort((a, b) => {
      if (a.importance !== b.importance) return a.importance ? -1 : 1;
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });

  // Today's plan and workday status for filtered period
  const today = getLocalDateString();
  const todaysPlan = filteredPlans.find(plan => plan.date === today);
  const todayDayOfWeek = todayDate.getDay();
  const isTodayWorkDay = workDays.includes(todayDayOfWeek);

  // --- Enhanced Session Analytics ---
  let doneCount = 0, skippedCount = 0, totalSessions = 0, plannedHours = 0, actualStudyHours = 0;
  const completedTaskIds = new Set(completedTasks.map(task => task.id));
  
  filteredPlans.forEach(plan => {
    plan.plannedTasks.forEach(session => {
      totalSessions++;
      plannedHours += session.allocatedHours;
      
      // Count sessions as done if they're marked done OR if their task is completed
      if (session.status === 'completed' || session.done || completedTaskIds.has(session.taskId)) {
        doneCount++;
        actualStudyHours += session.actualHours || session.allocatedHours;
      } else if (session.status === 'skipped') {
        skippedCount++;
      }
    });
  });

  // Calculate completion rate and efficiency
  const completionRate = totalSessions > 0 ? Math.round((doneCount / totalSessions) * 100) : 0;
  const efficiency = plannedHours > 0 ? Math.round((actualStudyHours / plannedHours) * 100) : 0;
  
  // Focus on positive metrics instead of missed sessions
  const hasCompletedSessions = doneCount > 0;

  // Check for manually rescheduled sessions
  const hasManualReschedules = studyPlans.some(plan => 
    plan.plannedTasks.some(session => 
      session.originalTime && session.originalDate && session.isManualOverride
    )
  );

  const stats = [
    {
      title: 'Total Tasks',
      value: tasks.length,
      subtitle: `${completedTasks.length} completed`,
      icon: BookOpen,
      color: 'bg-blue-500'
    },
    {
      title: 'Study Hours',
      value: formatTime(totalOriginalEstimatedHours),
      subtitle: `${formatTime(completedHours)} completed`,
      icon: Clock,
      color: 'bg-purple-500'
    },
    {
      title: 'Session Rate',
      value: `${completionRate}%`,
      subtitle: `${doneCount}/${totalSessions} sessions completed`,
      icon: TrendingUp,
      color: 'bg-green-500'
    },
    {
      title: 'Urgent Tasks',
      value: urgentTasks.length,
      subtitle: 'Due within 3 days',
      icon: Bell,
      color: 'bg-red-500'
    }
  ];

  return (
    <div className="space-y-8">

      {/* Positive reinforcement for completed sessions */}

      {/* Top row: Stat cards */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          {stats.map((stat, index) => (
            <div key={index} className={`flex items-center p-3 rounded-xl shadow-sm ${stat.color} bg-opacity-90 text-white min-w-0`}>
              <div className="flex-shrink-0 mr-3">
                <stat.icon className="w-7 h-7 opacity-80" />
              </div>
              <div className="truncate">
                <div className="text-lg font-bold leading-tight truncate">{stat.value}</div>
                <div className="text-xs opacity-80 truncate">{stat.title}</div>
                <div className="text-xs opacity-70 truncate">{stat.subtitle}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <EnvironmentCard />

          {useMemo(() => {
        const totalAllEstimatedHours = tasks.reduce((sum, task) => sum + task.estimatedHours, 0);
        
        const taskCompletionRate = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;
        const hoursCompletionRate = (totalAllEstimatedHours) > 0 ? Math.round((completedHours / (totalAllEstimatedHours)) * 100) : 0;
        const avgProgress = Math.round((taskCompletionRate + hoursCompletionRate) / 2);

        let quote, author, emoji;

        // Much more varied motivational quotes based on progress
        if (avgProgress === 0 && completedTasks.length === 0) {
          const startingQuotes = [
            { quote: "The secret of getting ahead is getting started.", author: "Mark Twain", emoji: "🚀" },
            { quote: "A year from now you may wish you had started today.", author: "Karen Lamb", emoji: "⏰" },
            { quote: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb", emoji: "🌱" },
            { quote: "You don't have to be great to get started, but you have to get started to be great.", author: "Les Brown", emoji: "✨" },
            { quote: "The journey of a thousand miles begins with one step.", author: "Lao Tzu", emoji: "👣" }
          ];
          const selected = startingQuotes[Math.floor(Math.random() * startingQuotes.length)];
          quote = selected.quote; author = selected.author; emoji = selected.emoji;
        } else if (avgProgress < 15) {
          const earlyQuotes = [
            { quote: "Small steps daily lead to big results yearly.", author: "Unknown", emoji: "🌱" },
            { quote: "Progress is impossible without change.", author: "George Bernard Shaw", emoji: "🔄" },
            { quote: "Every expert was once a beginner.", author: "Helen Hayes", emoji: "🔰" },
            { quote: "Rome wasn't built in a day, but they were laying bricks every hour.", author: "John Heywood", emoji: "🧱" },
            { quote: "A little progress each day adds up to big results.", author: "Unknown", emoji: "📊" }
          ];
          const selected = earlyQuotes[Math.floor(Math.random() * earlyQuotes.length)];
          quote = selected.quote; author = selected.author; emoji = selected.emoji;
        } else if (avgProgress < 35) {
          const buildingQuotes = [
            { quote: "Success is the sum of small efforts repeated day in and day out.", author: "Robert Collier", emoji: "🔥" },
            { quote: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson", emoji: "⏰" },
            { quote: "The difference between ordinary and extraordinary is that little extra.", author: "Jimmy Johnson", emoji: "⭐" },
            { quote: "Momentum is a beautiful thing.", author: "Unknown", emoji: "🌪️" },
            { quote: "Excellence is not a skill, it's an attitude.", author: "Ralph Marston", emoji: "💎" }
          ];
          const selected = buildingQuotes[Math.floor(Math.random() * buildingQuotes.length)];
          quote = selected.quote; author = selected.author; emoji = selected.emoji;
        } else if (avgProgress < 60) {
          const momentumQuotes = [
            { quote: "You're closer than you think. Keep going!", author: "Unknown", emoji: "🎯" },
            { quote: "The middle is messy, but it's also where the magic happens.", author: "Brené Brown", emoji: "✨" },
            { quote: "Persistence is the hard work you do after you get tired of doing the hard work you already did.", author: "Newt Gingrich", emoji: "💪" },
            { quote: "Half the battle is just showing up.", author: "Woody Allen", emoji: "🏃" },
            { quote: "Progress, not perfection.", author: "Unknown", emoji: "📈" }
          ];
          const selected = momentumQuotes[Math.floor(Math.random() * momentumQuotes.length)];
          quote = selected.quote; author = selected.author; emoji = selected.emoji;
        } else if (avgProgress < 85) {
          const pushingQuotes = [
            { quote: "You're so close! The final push is always the hardest.", author: "Unknown", emoji: "🔋" },
            { quote: "Champions train, losers complain.", author: "Unknown", emoji: "🏆" },
            { quote: "The last mile is always the longest.", author: "Unknown", emoji: "🏁" },
            { quote: "Strong people don't give up, they find a way.", author: "Unknown", emoji: "💎" },
            { quote: "When you feel like quitting, think about why you started.", author: "Unknown", emoji: "🌟" }
          ];
          const selected = pushingQuotes[Math.floor(Math.random() * pushingQuotes.length)];
          quote = selected.quote; author = selected.author; emoji = selected.emoji;
        } else if (avgProgress < 100) {
          const almostQuotes = [
            { quote: "The last 10% separates the good from the great.", author: "Unknown", emoji: "💫" },
            { quote: "Finishing strong is an art form.", author: "Unknown", emoji: "🎨" },
            { quote: "You can see the finish line. Sprint!", author: "Unknown", emoji: "🏃‍♂️" },
            { quote: "Excellence is doing ordinary things extraordinarily well.", author: "John W. Gardner", emoji: "👑" },
            { quote: "The final stretch is where legends are made.", author: "Unknown", emoji: "⚡" }
          ];
          const selected = almostQuotes[Math.floor(Math.random() * almostQuotes.length)];
          quote = selected.quote; author = selected.author; emoji = selected.emoji;
        } else {
          const completedQuotes = [
            { quote: "Well done! Success is a journey, not a destination.", author: "Ben Sweetland", emoji: "🏆" },
            { quote: "The expert in anything was once a beginner.", author: "Helen Hayes", emoji: "🎓" },
            { quote: "What's next? The best is yet to come!", author: "Unknown", emoji: "🚀" },
            { quote: "Celebrate your wins, then set new goals.", author: "Unknown", emoji: "🎉" },
            { quote: "You didn't just complete tasks, you built discipline.", author: "Unknown", emoji: "💪" }
          ];
          const selected = completedQuotes[Math.floor(Math.random() * completedQuotes.length)];
          quote = selected.quote; author = selected.author; emoji = selected.emoji;
        }

        return (
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl p-6 border border-blue-100 dark:border-blue-800 mb-6 flex flex-col md:flex-row items-center justify-center text-center md:text-left">
            <div className="text-4xl mr-0 md:mr-6 mb-4 md:mb-0">
              <span className="bg-white/50 dark:bg-gray-800/50 p-3 rounded-full">{emoji}</span>
            </div>
            <div className="flex-1">
              <blockquote className="text-center md:text-left">
                <p className="text-gray-700 dark:text-gray-300 font-medium text-lg leading-relaxed mb-2">
                  "{quote}"
                </p>
                <footer className="text-gray-500 dark:text-gray-400 text-sm">
                  — {author}
                </footer>
              </blockquote>
            </div>
          </div>
        );
      }, [Math.floor((tasks.length > 0 ? (completedTasks.length / tasks.length) * 100 : 0) / 10), completedTasks.length])}

      {/* Progress Overview and Today's Sessions - Side by Side */}
      <div className="flex flex-col lg:flex-row gap-6 mb-6">
        {/* Progress Overview - Left Side */}
        <div className="bg-white rounded-xl shadow-lg p-6 dark:bg-gray-900 dark:shadow-gray-900 max-w-fit">
          <h2 className="text-xl font-semibold text-gray-800 mb-4 dark:text-white">Progress Overview</h2>
          
          <div className="flex flex-col gap-6">
            {/* Task Completion Circle Chart */}
            <div className="flex flex-col items-center">
              <h3 className="text-lg font-medium text-gray-700 mb-4 dark:text-gray-300">Task Completion</h3>
              <div className="relative w-32 h-32">
                <SafePieChart
                  data={[
                    { name: 'Completed', value: completedTasks.length, color: '#10b981' },
                    { name: 'Pending', value: tasks.length - completedTasks.length, color: '#e5e7eb' }
                  ]}
                  innerRadius={35}
                  outerRadius={60}
                  formatter={(value, name) => [value, name]}
                  tooltipStyle={{
                    backgroundColor: '#1f2937',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#f9fafb'
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-800 dark:text-white">
                      {tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0}%
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 text-center">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {completedTasks.length}/{tasks.length}
                </div>
              </div>
              <div className="mt-4 flex space-x-4 text-sm">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
                  <span className="text-gray-600 dark:text-gray-300">Completed</span>
                </div>
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-gray-300 rounded-full mr-2"></div>
                  <span className="text-gray-600 dark:text-gray-300">Pending</span>
                </div>
              </div>
            </div>

            {/* Study Hours Progress Circle Chart */}
            <div className="flex flex-col items-center">
              <h3 className="text-lg font-medium text-gray-700 mb-4 dark:text-gray-300">Study Hours Progress</h3>
              <div className="relative w-32 h-32">
                <SafePieChart
                  data={[
                    { name: 'Completed', value: completedHours, color: '#8b5cf6' },
                    { name: 'Remaining', value: Math.max(0, totalOriginalEstimatedHours - completedHours), color: '#e5e7eb' }
                  ]}
                  innerRadius={35}
                  outerRadius={60}
                  formatter={(value, name) => [typeof value === 'number' ? formatTime(value) : value, name]}
                  tooltipStyle={{
                    backgroundColor: '#1f2937',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#f9fafb'
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-800 dark:text-white">
                      {totalOriginalEstimatedHours > 0 ? Math.round((completedHours / totalOriginalEstimatedHours) * 100) : 0}%
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-2 text-center">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {(() => {
                    const formatSmartTime = (hours: number) => {
                      const totalMinutes = Math.round(hours * 60);
                      const h = Math.floor(totalMinutes / 60);
                      const m = totalMinutes % 60;
                      if (h > 0 && m > 0) return `${h}h ${m}m`;
                      if (h > 0) return `${h}h`;
                      if (m > 0) return `${m}m`;
                      return '0h';
                    };
                    const completed = completedHours;
                    const total = totalOriginalEstimatedHours;
                    if (completed > 0) {
                      return `${formatSmartTime(completed)}/${formatSmartTime(total)}`;
                    } else {
                      return formatSmartTime(total);
                    }
                  })()}
                </div>
              </div>
              <div className="mt-4 flex space-x-4 text-sm">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-purple-500 rounded-full mr-2"></div>
                  <span className="text-gray-600 dark:text-gray-300">Completed</span>
                </div>
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-gray-300 rounded-full mr-2"></div>
                  <span className="text-gray-600 dark:text-gray-300">Remaining</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Today's Sessions - Right Side */}
        <div className="flex-1">
          {!isTodayWorkDay ? (
            <div className="bg-white rounded-xl shadow-lg p-3 dark:bg-gray-900 dark:shadow-gray-900">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center space-x-2 dark:text-white">
                <Calendar className="text-blue-600 dark:text-blue-400" size={24} />
                <span>Today's Sessions</span>
              </h2>
              <div className="text-center py-8">
                <div className="text-6xl mb-4">🎉</div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2 dark:text-white">No Work Today!</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  It's your day off! Time to relax, recharge, and maybe catch up on some Netflix. 📺
                </p>
                <div className="bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-900 dark:to-pink-900 rounded-lg p-4">
                  <p className="text-sm text-gray-700 dark:text-gray-200">
                    <span className="font-medium">Pro tip:</span> Use this time to plan your next study session or just enjoy your well-deserved break! ✨
                  </p>
                </div>
              </div>
            </div>
          ) : todaysPlan ? (
            <div className="bg-white rounded-xl shadow-lg p-3 dark:bg-gray-900 dark:shadow-gray-900">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center space-x-2 dark:text-white">
                <Calendar className="text-blue-600 dark:text-blue-400" size={24} />
                <span>Today's Sessions</span>
              </h2>
              <div className="text-gray-600 mb-2 dark:text-gray-300">
                {(() => {
                  const activeSessions = todaysPlan.plannedTasks.filter(session => {
                    return session.status !== 'skipped';
                  });
                  const activeSessionCount = activeSessions.length;
                  const activeSessionHours = activeSessions.reduce((sum, session) => sum + session.allocatedHours, 0);
                  return `You have ${activeSessionCount} active session${activeSessionCount !== 1 ? 's' : ''} today, totaling ${formatTime(activeSessionHours)}.`;
                })()}
              </div>
              <div className="space-y-3">
                {todaysPlan.plannedTasks
                  .filter(session => {
                    // Show all active sessions (not completed or skipped)
                    return session.status !== 'skipped' && !session.done && session.status !== 'completed';
                  })
                  .sort((a, b) => {
                    // Sort by current start time chronologically
                    const [aHour, aMinute] = (a.startTime || '00:00').split(':').map(Number);
                    const [bHour, bMinute] = (b.startTime || '00:00').split(':').map(Number);
                    const aMinutes = aHour * 60 + aMinute;
                    const bMinutes = bHour * 60 + bMinute;
                    return aMinutes - bMinutes;
                  })
                  .map((session, index) => {
                  const task = tasks.find(t => t.id === session.taskId);
                  if (!task) return null;
                  const isDone = session.done;
                  const isCompleted = session.status === 'completed';
                  
                  // Check session status for display purposes only
                  const sessionStatusResult = checkSessionStatus(session, todaysPlan.date);
                  const isOverdue = sessionStatusResult === 'overdue';
                  const isRescheduled = session.isManualOverride;
                  
                  // Calculate progress for this task
                  const allSessionsForTask = studyPlans.flatMap(plan => plan.plannedTasks).filter(s => s.taskId === task.id);
                  const completedSessions = allSessionsForTask.filter(s => s.done).length;
                  const totalSessions = allSessionsForTask.length;
                  const progressPercent = totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0;
                  
                  // Enhanced color system for session status and importance
                  const statusColors = {
                    completed: {
                      bg: 'bg-emerald-50 border-l-emerald-500 dark:bg-emerald-900/20 dark:border-l-emerald-400',
                      text: 'text-emerald-700 dark:text-emerald-300',
                      icon: 'text-emerald-500 dark:text-emerald-400',
                      badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-200',
                      progress: 'bg-emerald-500'
                    },
                    missed: {
                      bg: 'bg-red-50 border-l-red-500 dark:bg-red-900/20 dark:border-l-red-400',
                      text: 'text-red-700 dark:text-red-300',
                      icon: 'text-red-500 dark:text-red-400',
                      badge: 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-200',
                      progress: 'bg-red-500'
                    },
                    overdue: {
                      bg: 'bg-amber-50 border-l-amber-500 dark:bg-amber-900/20 dark:border-l-amber-400',
                      text: 'text-amber-700 dark:text-amber-300',
                      icon: 'text-amber-500 dark:text-amber-400',
                      badge: 'bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-200',
                      progress: 'bg-amber-500'
                    },
                    rescheduled: {
                      bg: 'bg-indigo-50 border-l-indigo-500 dark:bg-indigo-900/20 dark:border-l-indigo-400',
                      text: 'text-indigo-700 dark:text-indigo-300',
                      icon: 'text-indigo-500 dark:text-indigo-400',
                      badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-800 dark:text-indigo-200',
                      progress: 'bg-indigo-500'
                    },
                    scheduled: {
                      bg: 'bg-slate-50 border-l-slate-300 dark:bg-slate-900/20 dark:border-l-slate-400',
                      text: 'text-slate-700 dark:text-slate-300',
                      icon: 'text-slate-500 dark:text-slate-400',
                      badge: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
                      progress: 'bg-gradient-to-r from-slate-500 to-slate-600'
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
                  let statusIcon = null;
                  let statusText = '';
                  
                  if (isDone || isCompleted) {
                    currentSessionStatus = 'completed';
                    statusIcon = <CheckCircle2 className={`${statusColors.completed.icon} mr-2`} size={22} />;
                    statusText = 'Completed';
                  } else if (isRescheduled) {
                    currentSessionStatus = 'rescheduled';
                    statusIcon = <Clock3 className={`${statusColors.rescheduled.icon} mr-2`} size={22} />;
                    statusText = 'Rescheduled';
                  } else {
                    statusIcon = <Clock3 className={`${statusColors.scheduled.icon} mr-2`} size={22} />;
                  }

                  const currentStatusColors = statusColors[currentSessionStatus as keyof typeof statusColors];
                  const importanceLevel = task.importance ? 'high' : 'low';
                  const importanceStyle = importanceColors[importanceLevel];
                  
                  return (
                    <div 
                      key={index} 
                      className={`p-4 border-l-4 rounded-lg flex items-center justify-between ${currentStatusColors.bg} ${importanceStyle.ring} ${!isDone && !isCompleted ? 'cursor-pointer hover:shadow-md' : 'cursor-default'}`}
                      onClick={() => !isDone && !isCompleted && todaysPlan && onSelectTask(task, { allocatedHours: session.allocatedHours, planDate: todaysPlan.date, sessionNumber: session.sessionNumber })}
                    >
                      <div className={`flex-1 flex items-center ${isDone || isCompleted ? 'pointer-events-none' : ''}`}>
                        {statusIcon}
                        <div>
                          <div className="flex items-center space-x-2 mb-2">
                            <h3 className={`font-medium ${isDone || isCompleted ? 'line-through text-gray-500 dark:text-gray-400' : currentStatusColors.text}`}>
                              {task.title}
                            </h3>
                            {task.category && (
                              <span className="text-sm text-gray-500 dark:text-gray-400">({task.category})</span>
                            )}
                            {statusText && (
                              <span className={`px-2 py-1 text-xs rounded-full ${currentStatusColors.badge}`}>
                                {statusText}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-300">
                            <div className="flex items-center space-x-1">
                              <Clock size={16} />
                              {session.startTime} - {session.endTime}
                            </div>
                            <div className="flex items-center space-x-1">
                              <TrendingUp size={16} />
                              <span>
                                {formatTime(session.allocatedHours)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className={`text-sm text-gray-500 mb-1 ml-4 dark:text-gray-400 ${isDone || isCompleted ? 'pointer-events-none' : ''}`}>
                        Due: {new Date(task.deadline).toLocaleDateString()}
                      </div>
                      {task.importance && (
                        <span className={`px-2 py-1 text-xs rounded-full ${importanceStyle.badge} ml-4`}>Important</span>
                      )}
                      {/* Task session progress bar */}
                      <div className={`w-32 ml-4 ${isDone || isCompleted ? 'pointer-events-none' : ''}`}>
                        <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                          <div
                            className={`h-2 rounded-full transition-all duration-300 ${currentStatusColors.progress}`}
                            style={{ width: `${progressPercent}%` }}
                          ></div>
                        </div>
                        <div className="text-xs text-gray-500 text-right mt-1 dark:text-gray-400">{completedSessions} / {totalSessions} sessions</div>
                      </div>
                    </div>
                  );
                })}
                
                {/* Show "No Sessions Planned" message when all sessions are filtered out */}
                {todaysPlan.plannedTasks.filter(session => {
                  return session.status !== 'skipped' && !session.done && session.status !== 'completed';
                }).length === 0 && (
                  <div className="text-center py-8">
                    <div className="text-4xl mb-4">📚</div>
                    <h3 className="text-xl font-semibold text-gray-800 mb-2 dark:text-white">No Sessions Planned</h3>
                    <p className="text-gray-600 dark:text-gray-300">
                      You have no study sessions planned for today. Time to generate a study plan! 🚀
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-lg p-3 dark:bg-gray-900 dark:shadow-gray-900">
              <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center space-x-2 dark:text-white">
                <Calendar className="text-blue-600 dark:text-blue-400" size={24} />
                <span>Today's Sessions</span>
              </h2>
              <div className="text-center py-8">
                <div className="text-4xl mb-4">📚</div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2 dark:text-white">No Sessions Planned</h3>
                <p className="text-gray-600 dark:text-gray-300">
                  You have no study sessions planned for today. Time to generate a study plan! ����
                </p>
              </div>
            </div>
          )}
        </div>
      </div>





      {/* Task Progress Details */}
      <div className="bg-white rounded-xl shadow-lg p-6 dark:bg-gray-900 dark:shadow-gray-900">
        <h2 className="text-xl font-semibold text-gray-800 mb-4 flex items-center space-x-2 dark:text-white">
          <TrendingUp className="text-blue-600 dark:text-blue-400" size={24} />
          <span>Task Progress Details</span>
        </h2>
        
        <div className="space-y-4">
          {tasks.filter(task => task.status !== 'completed').map((task) => {
            // Calculate task-specific progress
            const allSessionsForTask = studyPlans.flatMap(plan => plan.plannedTasks).filter(s => s.taskId === task.id);
            const completedSessions = allSessionsForTask.filter(s => s.done || s.status === 'completed');
            const skippedSessions = allSessionsForTask.filter(s => s.status === 'skipped');
            const totalSessions = allSessionsForTask.length;
            const completedHours = completedSessions.reduce((sum, session) => sum + session.allocatedHours, 0);
            const skippedHours = skippedSessions.reduce((sum, session) => sum + session.allocatedHours, 0);
            // Remaining hours should account for both completed and skipped sessions
            const remainingHours = Math.max(0, task.estimatedHours - completedHours - skippedHours);
            const progressPercent = task.estimatedHours > 0 ? ((completedHours + skippedHours) / task.estimatedHours) * 100 : 0;
            const sessionProgressPercent = totalSessions > 0 ? ((completedSessions.length + skippedSessions.length) / totalSessions) * 100 : 0;
            
            // Determine status and styling
            const isCompleted = task.status === 'completed';
            const isOverdue = new Date(task.deadline) < new Date();
            const daysUntilDeadline = Math.ceil((new Date(task.deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            
            let statusColor = 'bg-gray-500';
            let statusText = 'Pending';
            
            if (isCompleted) {
              statusColor = 'bg-green-500';
              statusText = 'Completed';
            } else if (isOverdue) {
              statusColor = 'bg-red-500';
              statusText = 'Overdue';
            } else if (daysUntilDeadline <= 3) {
              statusColor = 'bg-yellow-500';
              statusText = 'Urgent';
            } else if (daysUntilDeadline <= 7) {
              statusColor = 'bg-orange-500';
              statusText = 'Due Soon';
            }
            
            return (
              <div key={task.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-all duration-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <BookOpen className="text-blue-500 dark:text-blue-400" size={20} />
                    <div>
                      <h3 className="font-medium text-gray-800 dark:text-white">{task.title}</h3>
                      {task.category && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">{task.category}</p>
                    )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {task.importance && (
                      <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full dark:bg-yellow-900 dark:text-yellow-200">
                        Important
                      </span>
                    )}
                    <span className={`px-2 py-1 text-xs text-white rounded-full ${statusColor}`}>
                      {statusText}
                    </span>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                  {/* Hours Progress */}
                  <div>
                    <div className="flex justify-between text-sm text-gray-600 mb-1 dark:text-gray-300">
                      <span>Hours Progress</span>
                      <span>{formatTime(completedHours)} / {formatTime(task.estimatedHours)}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                      {remainingHours > 0 ? `${formatTime(remainingHours)} remaining` : 'All hours completed!'}
                      {skippedHours > 0 && (
                        <span className="text-yellow-600 dark:text-yellow-400"> • {formatTime(skippedHours)} skipped</span>
                      )}
                    </div>
                  </div>
                  
                  {/* Sessions Progress */}
                  <div>
                    <div className="flex justify-between text-sm text-gray-600 mb-1 dark:text-gray-300">
                      <span>Sessions Progress</span>
                      <span>{completedSessions.length + skippedSessions.length} / {totalSessions} sessions</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                      <div 
                        className="bg-gradient-to-r from-green-500 to-teal-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${sessionProgressPercent}%` }}
                      ></div>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 dark:text-gray-400">
                      {totalSessions > 0 ? `${totalSessions - completedSessions.length - skippedSessions.length} sessions remaining` : 'No sessions scheduled'}
                      {skippedSessions.length > 0 && (
                        <span className="text-yellow-600 dark:text-yellow-400"> • {skippedSessions.length} skipped</span>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-300">
                  <span>Deadline: {new Date(task.deadline).toLocaleDateString()}</span>
                  {!isCompleted && (
                    <span className={daysUntilDeadline <= 0 ? 'text-red-600 dark:text-red-400' : daysUntilDeadline <= 3 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'}>
                      {daysUntilDeadline <= 0 ? 'Overdue' : 
                       daysUntilDeadline === 1 ? 'Due tomorrow' : 
                       `Due in ${daysUntilDeadline} days`}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Move session analytics, recent activities, and table into a compact grid at the bottom */}
      {/* Habits Card */}
      <HabitTracker habits={habits} onAddHabit={onAddHabit} onToggleHabitToday={onToggleHabitToday} onDeleteHabit={onDeleteHabit} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        {/* Session Analytics Card - Bottom */}
        <div className="bg-white rounded-xl shadow p-4 dark:bg-gray-900 dark:shadow-gray-900 flex flex-col justify-between min-h-[180px]">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white">Session Analytics</h2>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600 dark:text-gray-300 mr-2">Period:</label>
              <select
                className="border rounded-lg px-2 py-1 text-xs shadow-sm focus:ring-2 focus:ring-blue-400 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100"
                value={analyticsFilter}
                onChange={e => setAnalyticsFilter(e.target.value as any)}
              >
                <option value="all">All time</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="custom">Custom</option>
              </select>
              {analyticsFilter === 'custom' && (
                <>
                  <input
                    type="date"
                    className="border rounded px-2 py-1 ml-2 text-xs dark:bg-gray-700 dark:text-white"
                    value={customStart}
                    onChange={e => setCustomStart(e.target.value)}
                  />
                  <span className="mx-1 text-xs">to</span>
                  <input
                    type="date"
                    className="border rounded px-2 py-1 text-xs dark:bg-gray-700 dark:text-white"
                    value={customEnd}
                    onChange={e => setCustomEnd(e.target.value)}
                  />
                </>
              )}
            </div>
          </div>
          <div className="flex items-center justify-around text-center">
            <div>
              <div className="text-xl font-bold text-green-600 dark:text-green-400">{doneCount}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">Done{totalSessions > 0 ? ` (${((doneCount/totalSessions)*100).toFixed(0)}%)` : ''}</div>
            </div>
            <div>
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400">{totalSessions - doneCount - skippedCount}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">Remaining{totalSessions > 0 ? ` (${(((totalSessions - doneCount - skippedCount)/totalSessions)*100).toFixed(0)}%)` : ''}</div>
            </div>
            <div>
              <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{skippedCount}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">Skipped{totalSessions > 0 ? ` (${((skippedCount/totalSessions)*100).toFixed(0)}%)` : ''}</div>
            </div>
            <div>
              <div className="text-xl font-bold text-slate-600 dark:text-slate-300">{totalSessions}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">Total</div>
            </div>
          </div>
        </div>
        {/* Urgent Tasks Card - Bottom Right */}
        {urgentTasks.length > 0 ? (
          <div className="bg-white rounded-xl shadow p-4 dark:bg-gray-900 dark:shadow-gray-900 flex flex-col min-h-[180px]">
            <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center space-x-2 dark:text-white">
              <Bell className="text-red-600 dark:text-red-400" size={20} />
              <span>Urgent Tasks</span>
            </h2>
            <div className="space-y-3">
              {urgentTasks.slice(0, 5).map((task) => {
                const deadline = new Date(task.deadline);
                const now = new Date();
                const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                return (
                  <div key={task.id} className="flex items-center justify-between p-3 bg-red-50 border-l-4 border-red-500 rounded-lg dark:bg-red-900 dark:border-red-700">
                    <div>
                      <p className="font-medium text-gray-800 dark:text-white">{task.title}</p>
                      {task.category && (
                        <p className="text-sm text-gray-600 dark:text-gray-300">{task.category}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-red-600 dark:text-red-400">
                        {daysUntilDeadline <= 0 ? 'Overdue' : 
                         daysUntilDeadline === 1 ? 'Due tomorrow' : 
                         `Due in ${daysUntilDeadline} days`}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{formatTime(task.estimatedHours)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow p-4 dark:bg-gray-900 dark:shadow-gray-900 flex flex-col min-h-[180px] items-center justify-center">
            <span className="text-gray-400 dark:text-gray-600">No urgent tasks</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
