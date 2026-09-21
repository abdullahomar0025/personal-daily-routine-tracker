export const START_DATE = '2026-09-21';
export const END_DATE = '2026-12-31';

export const ROUTINE = [
  { id: 'internationalNews', period: 'সকাল', time: '06:00 AM – 08:00 AM', name: 'Telegram International News Update', target: 10, unit: 'নিউজ', quantity: true, color: '#6c63ff' },
  { id: 'infographic', period: 'সকাল', time: '08:20 AM – 09:30 AM', name: 'Infographics Poster', target: 1, unit: 'পোস্টার', quantity: true, color: '#f59e0b' },
  { id: 'newsPosterMorning', period: 'সকাল', time: '11:00 AM – 12:00 PM', name: 'News Poster', target: 2, unit: 'পোস্টার', quantity: true, color: '#ec4899' },
  { id: 'telegramNewsMorning', period: 'সকাল', time: '11:00 AM – 12:00 PM', name: 'Telegram News Update', target: 2, unit: 'আপডেট', quantity: true, color: '#0ea5e9' },
  { id: 'telegramNewsNoon', period: 'দুপুর', time: '12:00 PM – 01:00 PM', name: 'Telegram News Update', target: 3, unit: 'আপডেট', quantity: true, color: '#14b8a6' },
  { id: 'newsPosterAfternoon', period: 'দুপুর', time: '02:00 PM – 05:00 PM', name: 'News Poster', target: 2, unit: 'পোস্টার', quantity: true, color: '#f97316' },
  { id: 'aiLearning', period: 'বিকেল', time: 'Asr → Maghrib', name: 'AI Learning / AI Research', target: 1, unit: 'সেশন', quantity: false, color: '#8b5cf6' },
  { id: 'academicStudy', period: 'সন্ধ্যা', time: 'Maghrib → 09:00 PM', name: 'Academic Study', target: 1, unit: 'সেশন', quantity: false, color: '#22c55e' },
  { id: 'ielts', period: 'রাত', time: '09:30 PM – 11:00 PM', name: 'IELTS Preparation', target: 1, unit: 'সেশন', quantity: false, color: '#ef4444' },
];

export function isRoutineDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= START_DATE && date <= END_DATE;
}

export function blankDay() {
  return Object.fromEntries(ROUTINE.map(task => [task.id, task.quantity
    ? { actual: 0, completed: false, updatedAt: null }
    : { completed: false, updatedAt: null }]));
}

function taskById(id) {
  const task = ROUTINE.find(item => item.id === id);
  if (!task) throw new Error(`Unknown task: ${id}`);
  return task;
}

export function updateQuantity(day, id, value) {
  const task = taskById(id);
  if (!task.quantity) throw new Error(`${id} is not a quantity task`);
  const actual = Math.max(0, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0);
  return {
    ...day,
    [id]: { actual, completed: actual >= task.target, updatedAt: new Date().toISOString() },
  };
}

export function toggleTask(day, id) {
  const task = taskById(id);
  const current = day[id] ?? (task.quantity ? { actual: 0, completed: false } : { completed: false });
  if (task.quantity) return updateQuantity(day, id, current.completed ? 0 : task.target);
  return {
    ...day,
    [id]: { completed: !current.completed, updatedAt: new Date().toISOString() },
  };
}

export function dayProgress(day = blankDay()) {
  const completed = ROUTINE.filter(task => Boolean(day[task.id]?.completed)).length;
  const total = ROUTINE.length;
  return { completed, incomplete: total - completed, total, percentage: Math.round((completed / total) * 100) };
}

function previousDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function currentStreak(history, throughDate) {
  let date = throughDate;
  let streak = 0;
  while (isRoutineDate(date) && dayProgress(history[date] ?? blankDay()).percentage >= 70) {
    streak += 1;
    date = previousDate(date);
  }
  return streak;
}

export function analyseHistory(history) {
  const entries = Object.entries(history).filter(([date]) => isRoutineDate(date));
  const taskRates = ROUTINE.map(task => {
    const done = entries.filter(([, day]) => day[task.id]?.completed).length;
    return { id: task.id, name: task.name, done, total: entries.length, rate: entries.length ? Math.round((done / entries.length) * 100) : 0 };
  });
  const sorted = [...taskRates].sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  const totalRate = entries.length
    ? Math.round(entries.reduce((sum, [, day]) => sum + dayProgress(day).percentage, 0) / entries.length)
    : 0;
  const rate = id => taskRates.find(item => item.id === id)?.rate ?? 0;
  const quantityTotals = ROUTINE.filter(task => task.quantity).map(task => {
    const actual = entries.reduce((sum, [, day]) => sum + (day[task.id]?.actual ?? 0), 0);
    const target = task.target * entries.length;
    return { id: task.id, name: task.name, actual, target, rate: target ? Math.min(100, Math.round((actual / target) * 100)) : 0 };
  });
  return {
    daysTracked: entries.length,
    dailyAverage: totalRate,
    taskRates,
    quantityTotals,
    mostConsistent: sorted[0] ?? null,
    mostMissed: sorted.length ? sorted[sorted.length - 1] : null,
    ieltsConsistency: rate('ielts'),
    academicConsistency: rate('academicStudy'),
    aiConsistency: rate('aiLearning'),
  };
}

export function datesInRange(start = START_DATE, end = END_DATE) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const finish = new Date(`${end}T00:00:00Z`);
  while (cursor <= finish) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
