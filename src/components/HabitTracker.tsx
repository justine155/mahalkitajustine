import { Plus, CheckCircle2, Trash2, Flame, Sparkles, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Habit } from '../types';
import { getLocalDateString } from '../utils/scheduling';

interface HabitTrackerProps {
  habits: Habit[];
  onAddHabit: (habit: { title: string; cadence: 'daily' | 'weekly'; targetPerWeek?: number; reminder?: boolean }) => void;
  onToggleHabitToday: (habitId: string) => void;
  onDeleteHabit: (habitId: string) => void;
}

export default function HabitTracker({ habits, onAddHabit, onToggleHabitToday, onDeleteHabit }: HabitTrackerProps) {
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly'>('daily');
  const [targetPerWeek, setTargetPerWeek] = useState(3);

  const today = getLocalDateString();

  const handleAdd = () => {
    const t = title.trim();
    if (!t) return;
    onAddHabit({ title: t, cadence, targetPerWeek: cadence === 'weekly' ? Math.max(1, targetPerWeek) : undefined });
    setTitle('');
  };

  const weeklyProgress = (habit: Habit) => {
    if (habit.cadence !== 'weekly') return 0;
    const now = new Date(today);
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const count = habit.history.filter(d => {
      const dd = new Date(d);
      return dd >= startOfWeek && dd <= endOfWeek;
    }).length;
    return count;
  };

  const getLastNDays = (n: number) => {
    const arr: string[] = [];
    const d = new Date(today);
    for (let i = n - 1; i >= 0; i--) {
      const dd = new Date(d);
      dd.setDate(d.getDate() - i);
      arr.push(dd.toISOString().split('T')[0]);
    }
    return arr;
  };

  const sortedHabits = useMemo(() => {
    return [...habits].sort((a, b) => a.title.localeCompare(b.title));
  }, [habits]);

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6 dark:bg-gray-900 dark:shadow-gray-900 border border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2 dark:text-white">
          <span className="inline-flex p-2 rounded-lg bg-gradient-to-tr from-violet-500/15 to-indigo-500/15 text-violet-600 dark:text-violet-300">
            <Sparkles className="w-5 h-5" />
          </span>
          Habits
        </h2>
        {sortedHabits.length > 0 && (
          <div className="text-xs text-gray-500 dark:text-gray-400">Build streaks, not just checks ✅</div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New habit (e.g., Read 10 pages)"
          className="flex-1 border rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-violet-400/60 focus:outline-none"
        />
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as any)}
          className="border rounded-xl px-2 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-violet-400/60 focus:outline-none"
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        {cadence === 'weekly' && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 dark:text-gray-300">Target/week</label>
            <input
              type="number"
              min={1}
              max={7}
              value={targetPerWeek}
              onChange={(e) => setTargetPerWeek(Math.max(1, Math.min(7, parseInt(e.target.value || '1'))))}
              className="w-20 border rounded-xl px-2 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white focus:ring-2 focus:ring-violet-400/60 focus:outline-none"
            />
          </div>
        )}
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm hover:from-violet-700 hover:to-indigo-700 shadow-sm active:scale-[.98]"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {sortedHabits.length === 0 ? (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">No habits yet. Add your first habit!</div>
      ) : (
        <div className="space-y-3">
          {sortedHabits.map((habit) => {
            const doneToday = habit.history.includes(today);
            const weeklyDone = weeklyProgress(habit);
            const weeklyTarget = habit.cadence === 'weekly' ? (habit.targetPerWeek || 1) : undefined;
            const last7 = getLastNDays(7);

            return (
              <div
                key={habit.id}
                className={`relative overflow-hidden border rounded-2xl p-4 transition-colors ${
                  doneToday
                    ? 'border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/10 dark:to-teal-900/10'
                    : 'border-gray-200 dark:border-gray-700 bg-gradient-to-br from-white to-slate-50 dark:from-gray-900 dark:to-gray-900'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800 dark:text-white truncate max-w-[18rem]">{habit.title}</span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        {habit.cadence === 'daily' ? 'Daily' : 'Weekly'}
                      </span>
                      {habit.cadence === 'weekly' && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200 inline-flex items-center gap-1">
                          <Target className="w-3 h-3" /> {weeklyDone}/{weeklyTarget}
                        </span>
                      )}
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 inline-flex items-center gap-1">
                        <Flame className="w-3 h-3" /> Streak: {habit.streak}
                      </span>
                    </div>

                    {habit.cadence === 'daily' ? (
                      <div className="mt-3">
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Last 7 days</div>
                        <div className="grid grid-cols-7 gap-1.5">
                          {last7.map((d) => {
                            const hit = habit.history.includes(d);
                            return (
                              <div
                                key={d}
                                className={`h-3.5 rounded-md border ${
                                  hit
                                    ? 'bg-emerald-500 border-emerald-500'
                                    : 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600'
                                }`}
                                title={`${d}${hit ? ' • done' : ''}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">This week</div>
                        <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
                          <div
                            className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 transition-all"
                            style={{ width: `${Math.min(100, Math.round(((weeklyDone || 0) / (weeklyTarget || 1)) * 100))}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onToggleHabitToday(habit.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm border shadow-sm transition-all ${
                        doneToday
                          ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                      title={doneToday ? 'Mark as not done' : 'Mark as done today'}
                    >
                      <CheckCircle2 size={16} /> {doneToday ? 'Done' : 'Mark done'}
                    </button>
                    <button
                      onClick={() => onDeleteHabit(habit.id)}
                      className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition-colors dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-900/30"
                      title="Delete habit"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  {doneToday ? 'Done today' : 'Not done today'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
