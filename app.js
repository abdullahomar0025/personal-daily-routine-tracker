import {
  START_DATE, END_DATE, ROUTINE, isRoutineDate, blankDay, updateQuantity,
  toggleTask, dayProgress, currentStreak, analyseHistory, datesInRange,
} from './tracker.mjs';
import { mergeStores } from './sync-core.mjs';
import {
  cloudAvailable, currentUser, signIn, signUp, signOut, pullAndMerge,
  pushStore, schedulePush, subscribeToRemote,
} from './cloud-sync.mjs';

const STORAGE_KEY = 'personal-routine-tracker-v1';
const $ = id => document.getElementById(id);
const bn = new Intl.NumberFormat('bn-BD');
const dateFmt = new Intl.DateTimeFormat('bn-BD', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'short' });
let store = loadStore();
let selectedDate = defaultDate();
let cloudUser = null;
let applyingRemote = false;

function loadStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { history: parsed.history || {}, activities: parsed.activities || [], theme: parsed.theme || 'light' };
  } catch {
    return { history: {}, activities: [], theme: 'light' };
  }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  if (cloudUser && !applyingRemote) schedulePush(store, cloudUser.id, setSyncStatus);
}

function defaultDate() {
  const today = new Date();
  const local = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (local < START_DATE) return START_DATE;
  if (local > END_DATE) return END_DATE;
  return local;
}

function parseDate(date) {
  return new Date(`${date}T12:00:00`);
}

function getDay(date = selectedDate) {
  return store.history[date] || blankDay();
}

function commitDay(day, activityText) {
  store.history[selectedDate] = day;
  if (activityText) {
    store.activities.unshift({ text: activityText, date: selectedDate, at: new Date().toISOString() });
    store.activities = store.activities.slice(0, 30);
  }
  saveStore();
  renderAll();
}

function taskStatus(task, value) {
  if (value.completed) return 'সম্পন্ন';
  if (task.quantity && value.actual > 0) return 'আংশিক';
  return 'বাকি';
}

function renderTasks() {
  const day = getDay();
  const container = $('taskList');
  container.innerHTML = '';
  let period = '';
  ROUTINE.forEach(task => {
    if (task.period !== period) {
      period = task.period;
      const label = document.createElement('div');
      label.className = 'period-label';
      label.textContent = period;
      container.append(label);
    }
    const value = day[task.id];
    const card = document.createElement('article');
    card.className = `task-card${value.completed ? ' done' : ''}`;
    card.style.setProperty('--task-color', task.color);
    card.innerHTML = `
      <input class="check" type="checkbox" ${value.completed ? 'checked' : ''} aria-label="${task.name} সম্পন্ন">
      <div class="time">${task.time}</div>
      <div class="task-meta"><div class="task-name">${task.name}</div><div class="target">Target: ${bn.format(task.target)} ${task.unit}</div></div>
      ${task.quantity ? `<div class="quantity"><button type="button" data-action="minus" aria-label="কমাও">−</button><input type="number" min="0" value="${value.actual}" aria-label="${task.name} actual"><button type="button" data-action="plus" aria-label="বাড়াও">+</button></div>` : `<div class="status">${taskStatus(task, value)}</div>`}`;
    const checkbox = card.querySelector('.check');
    checkbox.addEventListener('change', () => {
      const next = toggleTask(getDay(), task.id);
      next[task.id].updatedAt = new Date().toISOString();
      commitDay(next, `${task.name}: ${next[task.id].completed ? 'সম্পন্ন' : 'বাকি'}`);
    });
    if (task.quantity) {
      const input = card.querySelector('input[type=number]');
      const apply = valueToSet => {
        const next = updateQuantity(getDay(), task.id, valueToSet);
        next[task.id].updatedAt = new Date().toISOString();
        commitDay(next, `${task.name}: ${next[task.id].actual}/${task.target}`);
      };
      input.addEventListener('change', () => apply(input.value));
      card.querySelector('[data-action=minus]').addEventListener('click', () => apply((getDay()[task.id]?.actual || 0) - 1));
      card.querySelector('[data-action=plus]').addEventListener('click', () => apply((getDay()[task.id]?.actual || 0) + 1));
      const status = document.createElement('div');
      status.className = 'status quantity-status';
      status.textContent = taskStatus(task, value);
      card.append(status);
    }
    container.append(card);
  });
}

function renderProgress() {
  const progress = dayProgress(getDay());
  $('completionPercent').textContent = `${bn.format(progress.percentage)}%`;
  $('completedCount').textContent = bn.format(progress.completed);
  $('incompleteCount').textContent = bn.format(progress.incomplete);
  $('taskSummary').textContent = `${bn.format(progress.completed)}/${bn.format(progress.total)} সম্পন্ন`;
  $('progressMessage').textContent = progress.percentage === 100 ? 'দারুণ! সব সম্পন্ন 🎉' : progress.percentage >= 70 ? 'চমৎকার এগোচ্ছেন' : progress.percentage ? 'ভালো শুরু হয়েছে' : 'শুরু করা যাক';
  $('progressRing').style.setProperty('--p', progress.percentage);
  $('streakCount').textContent = bn.format(currentStreak(store.history, selectedDate));
  $('selectedDayLabel').textContent = dateFmt.format(parseDate(selectedDate));
}

function previousDays(end, count) {
  const days = [];
  const cursor = parseDate(end);
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(cursor);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (isRoutineDate(key)) days.push(key);
  }
  return days;
}

function renderWeekly() {
  const dates = previousDays(selectedDate, 7);
  const chart = $('weeklyChart');
  chart.innerHTML = dates.map(date => {
    const pct = dayProgress(store.history[date] || blankDay()).percentage;
    return `<div class="bar-wrap" title="${date}: ${pct}%"><div class="bar"><i style="height:${pct}%"></i></div><span>${new Intl.DateTimeFormat('bn-BD', { weekday: 'short' }).format(parseDate(date))}</span></div>`;
  }).join('');
  const avg = dates.length ? Math.round(dates.reduce((sum, date) => sum + dayProgress(store.history[date] || blankDay()).percentage, 0) / dates.length) : 0;
  $('weeklyRate').textContent = `${bn.format(avg)}%`;
}

function renderCalendar() {
  const current = parseDate(selectedDate);
  const year = current.getFullYear();
  const month = current.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const labels = ['র','সো','ম','বু','বৃ','শু','শ'];
  const parts = labels.map(label => `<span class="weekday">${label}</span>`);
  for (let i = 0; i < first.getDay(); i += 1) parts.push('<span></span>');
  for (let day = 1; day <= last.getDate(); day += 1) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pct = dayProgress(store.history[key] || blankDay()).percentage;
    const cls = [key === selectedDate ? 'selected' : '', pct === 100 ? 'complete' : pct > 0 ? 'partial' : ''].filter(Boolean).join(' ');
    parts.push(isRoutineDate(key) ? `<button type="button" data-date="${key}" class="${cls}">${bn.format(day)}</button>` : `<span>${bn.format(day)}</span>`);
  }
  $('calendar').innerHTML = parts.join('');
  $('calendar').querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => setDate(button.dataset.date)));
}

function renderActivity() {
  const list = store.activities.slice(0, 5);
  $('activityList').innerHTML = list.length ? list.map(item => `<div class="activity"><i></i><div><strong>${escapeHtml(item.text)}</strong><small>${shortFmt.format(parseDate(item.date))}</small></div></div>`).join('') : '<div class="empty">এখনও কোনো activity নেই</div>';
}

function renderHistory() {
  const allDates = datesInRange().filter(date => date <= selectedDate).reverse();
  $('trackedDays').textContent = bn.format(Object.keys(store.history).filter(isRoutineDate).length);
  $('historyList').innerHTML = allDates.map(date => {
    const progress = dayProgress(store.history[date] || blankDay());
    return `<div class="history-row" data-date="${date}"><strong>${shortFmt.format(parseDate(date))}</strong><div class="mini-progress"><i style="width:${progress.percentage}%"></i></div><b>${bn.format(progress.percentage)}%</b></div>`;
  }).join('');
  $('historyList').querySelectorAll('[data-date]').forEach(row => row.addEventListener('click', () => { setDate(row.dataset.date); showView('dashboard'); }));
}

function renderAnalysis() {
  const analysis = analyseHistory(store.history);
  $('analysisSummary').innerHTML = [
    ['Daily average', `${bn.format(analysis.dailyAverage)}%`],
    ['IELTS consistency', `${bn.format(analysis.ieltsConsistency)}%`],
    ['Academic consistency', `${bn.format(analysis.academicConsistency)}%`],
    ['AI Learning consistency', `${bn.format(analysis.aiConsistency)}%`],
  ].map(([label, value]) => `<article class="insight"><span>${label}</span><b>${value}</b></article>`).join('');
  $('taskRates').innerHTML = analysis.taskRates.map(item => rateRow(item.name, item.rate)).join('') || '<div class="empty">ট্র্যাকিং শুরু করলে এখানে বিশ্লেষণ দেখা যাবে</div>';
  $('quantityRates').innerHTML = analysis.quantityTotals.map(item => rateRow(`${item.name} (${bn.format(item.actual)}/${bn.format(item.target)})`, item.rate)).join('') || '<div class="empty">পরিমাণ যোগ করলে target analysis দেখা যাবে</div>';
}

function rateRow(label, rate) {
  return `<div class="rate-row"><span>${escapeHtml(label)}</span><div class="rate-track"><i style="width:${rate}%"></i></div><b>${bn.format(rate)}%</b></div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function showView(name) {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === name));
  if (name === 'history') renderHistory();
  if (name === 'analysis') renderAnalysis();
}

function setDate(date) {
  if (!isRoutineDate(date)) return;
  selectedDate = date;
  $('datePicker').value = date;
  renderAll();
}

function renderAll() {
  renderTasks();
  renderProgress();
  renderWeekly();
  renderCalendar();
  renderActivity();
  renderHistory();
  renderAnalysis();
}

function toast(message) {
  document.querySelector('.toast')?.remove();
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 2200);
}

function setSyncStatus(state = 'local') {
  const button = $('syncButton');
  button.className = `sync-button ${state}`;
  const labels = {
    local: 'এই ডিভাইসে সেভ হচ্ছে',
    syncing: 'Cloud-এ sync হচ্ছে…',
    synced: 'সব ডিভাইসে synced',
    error: 'Sync সমস্যা—আবার চেষ্টা করুন',
  };
  $('syncLabel').textContent = labels[state] || labels.local;
}

function setAuthMessage(message = '', success = false) {
  $('authMessage').textContent = message;
  $('authMessage').classList.toggle('success', success);
}

function updateAuthPanel() {
  const signedIn = Boolean(cloudUser);
  $('signedOutPanel').hidden = signedIn;
  $('signedInPanel').hidden = !signedIn;
  $('signedInEmail').textContent = cloudUser?.email || '';
}

function openAuthModal() {
  updateAuthPanel();
  setAuthMessage();
  $('authModal').hidden = false;
  if (!cloudUser) $('authEmail').focus();
}

function closeAuthModal() {
  $('authModal').hidden = true;
  $('authPassword').value = '';
}

async function activateCloud(user) {
  if (!user) return;
  cloudUser = user;
  updateAuthPanel();
  setSyncStatus('syncing');
  const merged = await pullAndMerge(store, user.id);
  applyingRemote = true;
  store = merged;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  applyingRemote = false;
  document.body.classList.toggle('dark', store.theme === 'dark');
  $('themeButton').textContent = store.theme === 'dark' ? '☀' : '☾';
  renderAll();
  await pushStore(store, user.id);
  await subscribeToRemote(user.id, remoteStore => {
    const mergedRemote = mergeStores(store, remoteStore);
    if (JSON.stringify(mergedRemote) === JSON.stringify(store)) return;
    applyingRemote = true;
    store = mergedRemote;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    applyingRemote = false;
    renderAll();
    setSyncStatus('synced');
  }, setSyncStatus);
  setSyncStatus('synced');
}

async function initCloud() {
  if (!cloudAvailable) {
    setSyncStatus('error');
    return;
  }
  try {
    const user = await currentUser();
    if (user) await activateCloud(user);
    else setSyncStatus('local');
  } catch (error) {
    console.error('Cloud initialization failed', error);
    setSyncStatus('error');
  }
}

async function submitAuth(mode) {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !email.includes('@')) return setAuthMessage('সঠিক email লিখুন।');
  if (password.length < 8) return setAuthMessage('Password কমপক্ষে ৮ অক্ষরের হতে হবে।');
  setAuthMessage(mode === 'signin' ? 'Login হচ্ছে…' : 'Account তৈরি হচ্ছে…', true);
  try {
    if (mode === 'signin') {
      const user = await signIn(email, password);
      await activateCloud(user);
      closeAuthModal();
      toast('Cloud sync চালু হয়েছে');
    } else {
      const data = await signUp(email, password);
      if (data.session?.user) {
        await activateCloud(data.session.user);
        closeAuthModal();
        toast('Account ও cloud sync চালু হয়েছে');
      } else {
        setAuthMessage('আপনার email inbox থেকে confirmation link খুলুন, তারপর এখানে Login করুন।', true);
      }
    }
  } catch (error) {
    setAuthMessage(error?.message || 'Login করা যায়নি। আবার চেষ্টা করুন।');
    setSyncStatus('error');
  }
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.view)));
$('syncButton').addEventListener('click', openAuthModal);
$('closeAuth').addEventListener('click', closeAuthModal);
$('authModal').addEventListener('click', event => { if (event.target === $('authModal')) closeAuthModal(); });
$('signInButton').addEventListener('click', () => submitAuth('signin'));
$('signUpButton').addEventListener('click', () => submitAuth('signup'));
$('authPassword').addEventListener('keydown', event => { if (event.key === 'Enter') submitAuth('signin'); });
$('signOutButton').addEventListener('click', async () => {
  try {
    await signOut();
    cloudUser = null;
    updateAuthPanel();
    closeAuthModal();
    setSyncStatus('local');
    toast('Logout হয়েছে; local data রাখা হয়েছে');
  } catch (error) {
    setAuthMessage(error?.message || 'Logout করা যায়নি।');
  }
});
$('datePicker').addEventListener('change', event => setDate(event.target.value));
$('themeButton').addEventListener('click', () => {
  store.theme = store.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('dark', store.theme === 'dark');
  $('themeButton').textContent = store.theme === 'dark' ? '☀' : '☾';
  saveStore();
});
$('exportButton').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `routine-backup-${selectedDate}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  toast('Backup export হয়েছে');
});
$('importInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed.history !== 'object') throw new Error('invalid');
    store = { history: parsed.history || {}, activities: parsed.activities || [], theme: parsed.theme || 'light' };
    saveStore();
    document.body.classList.toggle('dark', store.theme === 'dark');
    renderAll();
    toast('Backup import হয়েছে');
  } catch { toast('Backup file সঠিক নয়'); }
  event.target.value = '';
});

document.body.classList.toggle('dark', store.theme === 'dark');
$('themeButton').textContent = store.theme === 'dark' ? '☀' : '☾';
$('datePicker').value = selectedDate;
renderAll();
initCloud();
