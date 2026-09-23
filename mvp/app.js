import { evaluateField, evaluateRubric, score } from './quality.mjs';

const rubricFields = [
  ['context', 'Контекст и потребность', 20, 'Что происходит сейчас и что нужно изменить?'],
  ['materials', 'Данные и материалы', 20, 'Какие данные, примеры или источники доступны?'],
  ['result', 'Ожидаемый результат', 15, 'Что команда должна подготовить?'],
  ['criteria', 'Критерии успеха', 15, 'По каким измеримым признакам вы примете результат?'],
  ['constraints', 'Ограничения', 10, 'Какие сроки, технологии и доступы важны?'],
  ['users', 'Пользователи', 10, 'Для кого создаётся решение?'],
  ['contact', 'Контакт и формат связи', 10, 'Кто даст обратную связь, как и когда?']
];
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const overlay = document.querySelector('#overlay');
let state = { tasks: [], teams: [], proposals: [], drafts: [] };
let signature = '';
let role = localStorage.getItem('hackalem-role') === 'business' ? 'business' : 'student';
let tab = 'catalog';
let teamId = localStorage.getItem('hackalem-team') || 'pixel';
let filter = 'Все задачи';
let levelFilter = 'Все уровни';
let query = '';
let toastTimer;
let theme = localStorage.getItem('hackalem-theme') || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const button = document.querySelector('#theme-toggle');
  button.textContent = theme === 'dark' ? '☀' : '☾';
  button.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
  button.title = button.getAttribute('aria-label');
}
applyTheme();
document.querySelector('#theme-toggle').onclick = () => { theme = theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('hackalem-theme', theme); applyTheme(); };

function html(value = '') { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function plural(count, one, few, many) { const n = Math.abs(Number(count)) % 100; const last = n % 10; return n > 10 && n < 20 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many; }
function level(points) { return points < 40 ? 'Черновик' : points < 70 ? 'Рабочая' : points < 90 ? 'Готовая' : 'Приоритетная'; }
function nextLevel(points) {
  if (points < 40) return { score: 40, name: 'Рабочая' };
  if (points < 70) return { score: 70, name: 'Готовая' };
  if (points < 90) return { score: 90, name: 'Приоритетная' };
  return null;
}
function missingFields(rubric = {}) {
  return rubricFields.filter(([key]) => !evaluateField(key, rubric[key]).ok).sort((a, b) => b[2] - a[2]);
}
function levelIcon(points) { return points >= 90 ? '★' : points >= 70 ? '✦' : points >= 40 ? '✓' : '○'; }
function changeText(change) {
  if (!change) return '';
  const delta = Number(change.scoreDelta) || 0;
  const points = delta ? `${delta > 0 ? '+' : ''}${delta} баллов` : 'рейтинг без изменения';
  const place = change.previousRank && change.previousRank !== change.newRank
    ? `место №${change.previousRank} → №${change.newRank}` : `место №${change.newRank}`;
  return `${points} · ${place}`;
}
function words(value) { return String(value || '').toLocaleLowerCase('ru').match(/[\p{L}\p{N}]+/gu) || []; }
function recommendationFor(task, team) {
  const skillWords = new Set(words(team.skills));
  const matchedSkills = (task.skills || []).filter(skill => words(skill).some(word => skillWords.has(word)));
  const taskText = words([task.title, task.desc, task.category].join(' '));
  const interests = [...new Set(words(team.interests).filter(word => word.length >= 5 && !['проект', 'сервис'].some(stop => word.startsWith(stop))))];
  const matchedInterests = interests.filter(word => taskText.some(taskWord => taskWord.startsWith(word.slice(0, 5))));
  return { score: matchedSkills.length * 3 + matchedInterests.length, matchedSkills, matchedInterests };
}
function proposalsFor(taskId) { return state.proposals.filter(p => String(p.taskId) === String(taskId)); }
function myProposals() { return state.proposals.filter(p => p.teamId === teamId); }
function teamName(id) { return state.teams.find(t => t.id === id)?.name || 'Команда'; }
function proposalXP(p) { return (p.stages || []).reduce((n, stage) => n + (stage.status === 'confirmed' ? Number(stage.points) || 0 : 0), 0) + (p.completedAt ? Number(p.completionBonus) || 0 : 0); }
function teamXP(id) { return state.proposals.filter(p => p.teamId === id).reduce((n, p) => n + proposalXP(p), 0); }
function teamLevel(xp) {
  if (xp < 20) return { name: 'Старт', number: 1, floor: 0, next: 20 };
  if (xp < 50) return { name: 'Практики', number: 2, floor: 20, next: 50 };
  if (xp < 90) return { name: 'Профи', number: 3, floor: 50, next: 90 };
  return { name: 'Эксперты', number: 4, floor: 90, next: null };
}
function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Ошибка запроса.');
  return value;
}
async function refresh(force = false) {
  const next = await api('/api/state');
  const nextSignature = JSON.stringify(next);
  if (force || nextSignature !== signature) {
    state = next; signature = nextSignature;
    if (!overlay.classList.contains('show')) render();
  }
}
async function run(action, success) {
  try { await action(); await refresh(true); if (success) toast(typeof success === 'function' ? success() : success); }
  catch (error) { toast(error.message || 'Не удалось сохранить изменение.'); }
}
function showModal(markup) { modal.innerHTML = markup; modal.dataset.kind = ''; overlay.classList.add('show'); modal.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal); }
function closeModal() { overlay.classList.remove('show'); modal.innerHTML = ''; }
overlay.onclick = event => { if (event.target === overlay && modal.dataset.kind !== 'task') closeModal(); };

function render() {
  document.querySelectorAll('[data-role]').forEach(b => b.classList.toggle('active', b.dataset.role === role));
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelector('[data-tab="my"]').firstChild.textContent = role === 'business' ? 'Черновики ' : 'Мои предложения ';
  document.querySelector('#reply-count').textContent = role === 'business' ? `(${state.drafts.length})` : `(${myProposals().length})`;
  document.querySelector('#avatar').textContent = role === 'business' ? 'ЗК' : 'СТ';
  if (tab === 'about') return renderAbout();
  if (tab === 'my' && role === 'business') return renderDrafts();
  const business = role === 'business';
  const team = state.teams.find(t => t.id === teamId) || state.teams[0];
  if (team && !state.teams.some(t => t.id === teamId)) teamId = team.id;
  const list = (tab === 'my' ? state.tasks.filter(t => myProposals().some(p => String(p.taskId) === String(t.id))) : state.tasks)
    .filter(t => (filter === 'Все задачи' || t.category === filter) && (levelFilter === 'Все уровни' || level(t.quality) === levelFilter)
      && (!query || [t.title, t.desc, t.company, ...(t.skills || [])].join(' ').toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))))
    .sort((a, b) => b.quality - a.quality);
  const rankById = new Map([...state.tasks].sort((a, b) => b.quality - a.quality).map((t, index) => [String(t.id), index + 1]));
  const experience = teamXP(teamId);
  app.innerHTML = `<div class="welcome"><div><div class="eyebrow">HackAlem AI · практические задачи</div><h1>${business ? 'Задачи для студенческих команд' : 'Выберите задачу для команды'}</h1><p>${business ? 'Уточняйте карточки, сравнивайте предложения и подтверждайте результат работы.' : 'Каталог открыт всем командам. Решение о сотрудничестве принимает заказчик.'}</p></div>
    ${business ? '<div class="welcome-actions"><button class="secondary" id="reset-demo">Сбросить демо</button><button class="primary" id="new-task">＋ Создать задачу</button></div>' : `<select class="filter" id="team-select" aria-label="Выбрать команду">${state.teams.map(t => `<option value="${html(t.id)}" ${t.id === teamId ? 'selected' : ''}>${html(t.name)} · ${t.members} ${plural(t.members, 'участник', 'участника', 'участников')}</option>`).join('')}</select>`}</div>
    <section class="hero"><div><h2>${business ? 'Рейтинг отражает готовность задачи' : 'Предлагайте решение самостоятельно'}</h2><p>${business ? 'Баллы начисляются за сведения, которые вы проверили и подтвердили. Чем полнее карточка, тем выше она в каталоге.' : 'Откройте любую задачу, отправьте идею и план. После выбора команды можно показать этап работы на подтверждение.'}</p></div><div class="hero-stat"><div class="stat"><b>${state.tasks.length}</b><span>${plural(state.tasks.length, 'задача', 'задачи', 'задач')}</span></div><div class="stat"><b>${state.proposals.length}</b><span>${plural(state.proposals.length, 'предложение', 'предложения', 'предложений')}</span></div><div class="stat"><b>${business ? state.drafts.length : experience}</b><span>${business ? plural(state.drafts.length, 'черновик', 'черновика', 'черновиков') : 'XP команды'}</span></div></div></section>
    ${business && tab === 'catalog' ? businessGamePanel() : ''}
    ${!business && team ? teamProgressPanel(team) + rankRewardSection(team) : ''}
    ${!business && tab === 'catalog' && team ? recommendationSection(team) : ''}
    <div class="toolbar"><h2>${tab === 'my' ? 'Мои предложения' : 'Открытый каталог'} <span class="small">${list.length} ${plural(list.length, 'задача', 'задачи', 'задач')}</span></h2><input class="search" id="search" type="search" placeholder="Найти задачу" value="${html(query)}" aria-label="Поиск по задачам"><div class="filters">${['Все задачи', 'Веб-разработка', 'Дизайн', 'Исследование'].map(f => `<button class="filter ${f === filter ? 'active' : ''}" data-filter="${html(f)}">${html(f)}</button>`).join('')}<select class="filter" id="level-filter" aria-label="Уровень готовности">${['Все уровни', 'Черновик', 'Рабочая', 'Готовая', 'Приоритетная'].map(l => `<option ${l === levelFilter ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="cards" id="cards">${list.length ? list.map(t => taskCard(t, rankById.get(String(t.id)))).join('') : '<div class="empty">Задачи не найдены. Измените фильтр или поиск.</div>'}</div>`;
  document.querySelector('#new-task')?.addEventListener('click', () => openForm());
  document.querySelector('#reset-demo')?.addEventListener('click', () => {
    if (!window.confirm('Сбросить задачи, черновики и предложения к демонстрационным данным? Текущее состояние сохранится в data/backups.')) return;
    run(async () => { await api('/api/reset-demo', 'POST', { confirm: 'RESET_DEMO' }); filter = 'Все задачи'; levelFilter = 'Все уровни'; query = ''; tab = 'catalog'; }, 'Демонстрационные данные восстановлены.');
  });
  document.querySelector('#team-select')?.addEventListener('change', e => { teamId = e.target.value; localStorage.setItem('hackalem-team', teamId); render(); });
  document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; render(); });
  document.querySelector('#level-filter').onchange = e => { levelFilter = e.target.value; render(); };
  document.querySelector('#search').oninput = e => { query = e.target.value; render(); document.querySelector('#search').focus(); document.querySelector('#search').setSelectionRange(query.length, query.length); };
  document.querySelectorAll('[data-task]').forEach(b => b.onclick = () => openTask(b.dataset.task));
  document.querySelector('[data-improve]')?.addEventListener('click', e => openForm(state.tasks.find(t => String(t.id) === e.currentTarget.dataset.improve)));
}
function businessGamePanel() {
  const task = [...state.tasks].sort((a, b) => a.quality - b.quality)[0];
  if (!task) return '';
  const next = nextLevel(task.quality);
  const missing = missingFields(task.rubric);
  return `<section class="gamify" aria-label="Прогресс задачи"><div><div class="game-title"><div class="level-icon">${levelIcon(task.quality)}</div><span>Следующая цель заказчика</span><span class="game-points">${task.quality}/100</span></div><div class="game-sub"><b>${html(task.title)}</b> · ${level(task.quality)}. ${next ? `До уровня «${next.name}» осталось ${next.score - task.quality} баллов.` : 'Приоритетный уровень достигнут.'}</div><div class="game-meter"><div class="game-meter-row"><span>${next ? `Следующий уровень: ${next.name}` : 'Максимальный уровень'}</span><span>${task.quality}/${next?.score || 100}</span></div><div class="meter"><span style="width:${task.quality}%"></span></div></div><div class="game-sub">${missing.length ? `Добавьте: ${missing.slice(0, 2).map(([, label, points]) => `${html(label)} (+${points})`).join(', ')}.` : 'Все сведения заполнены и подтверждены.'}</div>${task.lastChange ? `<div class="game-sub">Последнее изменение: ${changeText(task.lastChange)}</div>` : ''}${missing.length ? `<button class="text-btn" data-improve="${html(task.id)}" style="margin-top:12px">Улучшить задачу →</button>` : ''}</div><div class="badges"><span class="badge ${task.quality >= 40 ? 'earned' : ''}"><i>✓</i> Рабочая · 40</span><span class="badge ${task.quality >= 70 ? 'earned' : ''}"><i>✦</i> Готовая · 70</span><span class="badge ${task.quality >= 90 ? 'earned' : ''}"><i>★</i> Приоритетная · 90</span></div></section>`;
}
function teamProgressPanel(team) {
  const xp = teamXP(team.id);
  const current = teamLevel(xp);
  const confirmed = state.proposals.filter(p => p.teamId === team.id).flatMap(p => p.stages || []).filter(stage => stage.status === 'confirmed').length;
  const completed = state.proposals.filter(p => p.teamId === team.id && p.completedAt).length;
  const progress = current.next ? Math.min(100, Math.round((xp - current.floor) / (current.next - current.floor) * 100)) : 100;
  return `<section class="gamify" aria-label="Прогресс команды"><div><div class="game-title"><div class="level-icon">✦</div><span>${html(team.name)} · уровень ${current.number}: ${current.name}</span><span class="game-points">${xp} XP</span></div><div class="game-sub">${current.next ? `До следующего уровня осталось ${current.next - xp} XP.` : 'Максимальный уровень достигнут.'}</div><div class="game-meter"><div class="game-meter-row"><span>${current.next ? `Следующий уровень: ${teamLevel(current.next).name}` : 'Максимальный уровень'}</span><span>${current.next ? `${xp}/${current.next}` : `${xp} XP`}</span></div><div class="meter"><span style="width:${progress}%"></span></div></div><div class="game-sub">+10 XP за подтверждённый этап (до трёх на работу) · +30 XP после завершения работы заказчиком. За просмотр и отправку предложения опыт не начисляется.</div></div><div class="badges"><span class="badge earned"><i>✓</i> ${confirmed} ${plural(confirmed, 'этап подтверждён', 'этапа подтверждены', 'этапов подтверждено')}</span><span class="badge ${completed ? 'earned' : ''}"><i>★</i> ${completed} ${plural(completed, 'работа завершена', 'работы завершены', 'работ завершено')}</span></div></section>`;
}
function rankRewardSection(team) {
  const xp = teamXP(team.id);
  const current = teamLevel(xp).number;
  const proposals = state.proposals.filter(p => p.teamId === team.id);
  const confirmed = proposals.flatMap(p => p.stages || []).filter(stage => stage.status === 'confirmed').length;
  const completed = proposals.filter(p => p.completedAt).length;
  const fullCycle = proposals.some(p => p.completedAt && (p.stages || []).filter(stage => stage.status === 'confirmed').length === 3);
  const ranks = [
    { number: 1, name: 'Старт', xp: 0, icon: '◆', style: 'rank-start' },
    { number: 2, name: 'Практики', xp: 20, icon: '✦', style: 'rank-practice' },
    { number: 3, name: 'Профи', xp: 50, icon: '★', style: 'rank-pro' },
    { number: 4, name: 'Эксперты', xp: 90, icon: '✺', style: 'rank-expert' }
  ];
  const rewards = [
    { name: 'Первый шаг', detail: 'Подтверждён первый этап', icon: '✓', earned: confirmed >= 1 },
    { name: 'Результат', detail: 'Завершена первая работа', icon: '🏆', earned: completed >= 1 },
    { name: 'Полный цикл', detail: 'Три этапа и завершение', icon: '✪', earned: fullCycle }
  ];
  return `<section class="rank-section" aria-label="Ранги и награды команды"><div class="rank-head"><div><h2>Ранги и награды</h2><p>Ранги открываются по XP; награды — за подтверждённые результаты.</p></div><div class="small">${xp} XP · ранг ${current}/4</div></div><div class="rank-track">${ranks.map(rank => `<div class="rank-card ${rank.style} ${xp >= rank.xp ? 'earned' : ''} ${current === rank.number ? 'current' : ''}" aria-label="${rank.name}: ${rank.xp} XP, ${xp >= rank.xp ? 'открыт' : 'закрыт'}"><div class="rank-medal" aria-hidden="true">${rank.icon}</div><div class="rank-meta"><b>${rank.name}</b><span>${rank.xp} XP · ${xp >= rank.xp ? 'открыт' : 'закрыт'}</span></div></div>`).join('')}</div><div class="reward-list">${rewards.map(reward => `<div class="reward ${reward.earned ? 'earned' : ''}" aria-label="${reward.name}: ${reward.earned ? 'получена' : 'не получена'}"><div class="reward-icon" aria-hidden="true">${reward.icon}</div><div><b>${reward.name} · ${reward.earned ? 'получена' : 'закрыта'}</b><span>${reward.detail}</span></div></div>`).join('')}</div></section>`;
}
function recommendationSection(team) {
  const picks = state.tasks
    .map(task => ({ task, match: recommendationFor(task, team), applied: myProposals().some(p => String(p.taskId) === String(task.id)) }))
    .filter(item => item.match.score > 0)
    .sort((a, b) => b.match.score - a.match.score || Number(a.applied) - Number(b.applied) || b.task.quality - a.task.quality)
    .slice(0, 3);
  return `<section class="recommendations" aria-label="Рекомендации для команды"><div class="recommendations-head"><div><div class="eyebrow">Подбор по навыкам и интересам</div><h2>${html(team.name)}: подходящие задачи</h2><p>Причины совпадения показаны в карточках. Полный каталог открыт ниже.</p></div></div><div class="recommendation-grid">${picks.length ? picks.map(({ task, match, applied }) => `<article class="recommendation-card"><div class="card-top"><span class="tag">${html(task.category)}</span><span class="match">${task.quality}/100 · ${level(task.quality)}</span></div><h3>${html(task.title)}</h3><p>${[match.matchedSkills.length ? `Навыки: ${html(match.matchedSkills.join(', '))}` : '', match.matchedInterests.length ? `Интерес: ${html(match.matchedInterests.join(', '))}` : ''].filter(Boolean).join(' · ')}</p>${applied ? '<div class="small">Предложение уже отправлено</div>' : ''}<button class="text-btn" data-task="${html(task.id)}">Открыть задачу →</button></article>`).join('') : '<div class="empty">Совпадений пока нет. Все задачи доступны в каталоге ниже.</div>'}</div></section>`;
}
function taskCard(t, rank) {
  const selected = proposalsFor(t.id).filter(p => p.status === 'selected').map(p => teamName(p.teamId));
  const next = nextLevel(t.quality);
  const missing = missingFields(t.rubric);
  return `<article class="card"><div class="card-top"><span class="tag">${html(t.category)}</span><span class="match">№${rank} в каталоге</span></div><h3>${html(t.title)}</h3><p>${html(t.desc)}</p><div class="readiness-card"><div class="readiness-card-head"><span class="readiness-level">${levelIcon(t.quality)} ${level(t.quality)}</span><b>${t.quality}/100</b></div><div class="meter"><span style="width:${t.quality}%"></span></div><div class="small">${next ? `Ещё ${next.score - t.quality} баллов до уровня «${next.name}»${missing.length ? ` · ${html(missing[0][1])} +${missing[0][2]}` : ''}` : 'Приоритетная задача · верхний уровень'}</div>${t.lastChange ? `<div class="small change-note">Последнее изменение: ${changeText(t.lastChange)}</div>` : ''}</div><div class="chips">${(t.skills || []).map(s => `<span class="chip">${html(s)}</span>`).join('')}</div><div class="card-foot"><div class="company"><div class="company-logo">${html(t.logo || 'З')}</div><div>${html(t.company)}<div class="small">${html(t.due)} · ${html(t.status || 'Открыта')}</div>${selected.length ? `<div class="small">Выбраны: ${html(selected.join(', '))}</div>` : ''}</div></div><button class="text-btn" data-task="${html(t.id)}">Подробнее →</button></div></article>`;
}
function renderDrafts() {
  app.innerHTML = `<div class="welcome"><div><div class="eyebrow">Работа заказчика</div><h1>Черновики задач</h1><p>Дополните сведения и подтвердите карточку перед публикацией.</p></div><button class="primary" id="new-task">＋ Новый черновик</button></div><div class="cards">${state.drafts.map(d => `<article class="card"><span class="tag">${html(d.category)}</span><h3>${html(d.title)}</h3><p>${html(d.description)}</p><button class="text-btn" data-draft="${html(d.id)}">Продолжить →</button></article>`).join('') || '<div class="empty">Черновиков пока нет.</div>'}</div>`;
  document.querySelector('#new-task').onclick = () => openForm();
  document.querySelectorAll('[data-draft]').forEach(b => b.onclick = () => openForm(state.drafts.find(d => d.id === b.dataset.draft)));
}
function renderAbout() {
  app.innerHTML = `<div class="welcome"><div><div class="eyebrow">Сквозной сценарий</div><h1>Как устроен «Старт»</h1><p>От слабого описания до подтверждённого этапа работы.</p></div></div><div class="cards">${[
    ['01', 'Заказчик создаёт черновик', 'Вводит свободное описание и сохраняет его.'],
    ['02', 'Система задаёт 3 вопроса', 'Ответы попадают в редактируемую карточку.'],
    ['03', 'Рейтинг меняет позицию', 'Подтверждённая задача публикуется в общем каталоге.'],
    ['04', 'Команды предлагают решения', 'Любая команда видит задачи и отправляет план.'],
    ['05', 'Заказчик выбирает вручную', 'Можно выбрать несколько команд или никого.'],
    ['06', 'Опыт за результат', 'Команда получает 10 XP за каждый из трёх подтверждённых этапов и ещё 30 XP после завершения работы заказчиком.']
  ].map(([n, title, desc]) => `<article class="card"><div class="eyebrow">Шаг ${n}</div><h3>${title}</h3><p>${desc}</p></article>`).join('')}</div>`;
}
function openTask(id) {
  const t = state.tasks.find(x => String(x.id) === String(id));
  if (!t) return;
  const mine = proposalsFor(t.id).find(p => p.teamId === teamId);
  const next = nextLevel(t.quality);
  const missing = missingFields(t.rubric);
  const rank = [...state.tasks].sort((a, b) => b.quality - a.quality).findIndex(item => String(item.id) === String(t.id)) + 1;
  showModal(`<div class="modal-head"><div><span class="tag">${html(t.category)}</span><h2 style="margin-top:12px">${html(t.title)}</h2><p>${html(t.company)} · ${html(t.due)}</p></div><button class="close" data-close>×</button></div>
    <p>${html(t.desc)}</p><div class="chips">${(t.skills || []).map(s => `<span class="chip">${html(s)}</span>`).join('')}</div><div class="scorebox"><div class="score-head"><span>${levelIcon(t.quality)} ${level(t.quality)} · №${rank} в каталоге</span><b>${t.quality}/100</b></div><div class="meter"><span style="width:${t.quality}%"></span></div><div class="suggestion" style="margin-bottom:9px">${next ? `До уровня «${next.name}» осталось ${next.score - t.quality} баллов.` : 'Приоритетный уровень достигнут.'}${missing.length ? ` Следующие поля: ${missing.slice(0, 2).map(([, label, points]) => `${html(label)} (+${points})`).join(', ')}.` : ''}</div>${t.lastChange ? `<div class="small change-note">Последнее изменение: ${changeText(t.lastChange)}</div>` : ''}${rubricFields.map(([key, label, points]) => `<div class="small">${evaluateField(key, t.rubric?.[key]).ok ? '✓' : '○'} ${label} — ${evaluateField(key, t.rubric?.[key]).ok ? points : 0}/${points}</div>`).join('')}</div>
    ${mine ? `<div class="scorebox"><b>Предложение команды:</b> ${mine.completedAt ? 'работа завершена' : mine.status === 'selected' ? 'выбрано' : mine.status === 'rejected' ? 'отклонено' : 'ожидает решения'}<div class="small">Опыт за эту работу: ${proposalXP(mine)} XP</div>${(mine.stages || []).map((stage, i) => `<div class="small">Этап ${i + 1}: ${html(stage.description)} · ${stage.status === 'confirmed' ? '+10 XP подтверждено' : 'ожидает подтверждения'}</div>`).join('')}</div>` : ''}
    <div class="small">${proposalsFor(t.id).length} ${plural(proposalsFor(t.id).length, 'предложение', 'предложения', 'предложений')} · задача доступна всем командам</div><div class="modal-actions"><button class="secondary" data-close>Закрыть</button>${role === 'business' ? `<button class="secondary" id="edit-task">Улучшить карточку</button><button class="primary" id="view-proposals">Предложения</button>` : mine?.status === 'selected' && !mine.completedAt ? `<button class="primary" id="submit-stage" ${(mine.stages || []).some(stage => stage.status === 'pending') || (mine.stages || []).length >= 3 ? 'disabled' : ''}>${(mine.stages || []).some(stage => stage.status === 'pending') ? 'Этап ожидает подтверждения' : (mine.stages || []).length >= 3 ? 'Три этапа выполнены' : 'Показать следующий этап'}</button>` : `<button class="primary" id="reply" ${mine ? 'disabled' : ''}>${mine ? mine.completedAt ? 'Работа завершена' : 'Предложение отправлено' : 'Подать предложение'}</button>`}</div>`);
  document.querySelector('#edit-task')?.addEventListener('click', () => openForm(t));
  document.querySelector('#view-proposals')?.addEventListener('click', () => openProposals(t.id));
  document.querySelector('#reply')?.addEventListener('click', () => openProposalForm(t));
  document.querySelector('#submit-stage')?.addEventListener('click', () => openStageForm(mine));
}

function formValues() {
  return { title: document.querySelector('#f-title').value.trim(), category: document.querySelector('#f-category').value,
    due: document.querySelector('#f-due').value.trim(), skills: document.querySelector('#f-skills').value.split(',').map(x => x.trim()).filter(Boolean),
    rubric: Object.fromEntries(rubricFields.map(([key]) => [key, document.querySelector(`#f-${key}`).value.trim()])) };
}
function localFormKey(item) { return `hackalem-card-form-v1:${item ? `${item.published ? 'task' : 'draft'}:${item.id}` : 'new'}`; }
function readLocalForm(key) {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value && typeof value === 'object' && value.rubric ? value : null; }
  catch { return null; }
}
function captureLocalForm() { return { ...formValues(), free: document.querySelector('#f-free').value, savedAt: Date.now() }; }
function restoreLocalForm(value) {
  document.querySelector('#f-free').value = value.free || '';
  document.querySelector('#f-title').value = value.title || '';
  document.querySelector('#f-category').value = value.category || 'Веб-разработка';
  document.querySelector('#f-due').value = value.due || '';
  document.querySelector('#f-skills').value = Array.isArray(value.skills) ? value.skills.join(', ') : '';
  rubricFields.forEach(([key]) => { document.querySelector(`#f-${key}`).value = value.rubric?.[key] || ''; });
  document.querySelector('#f-confirm').checked = false;
  updateScore();
}
function updateScore() {
  const rubric = formValues().rubric;
  const possible = score(rubric);
  const evaluation = evaluateRubric(rubric);
  const confirmed = document.querySelector('#f-confirm').checked;
  document.querySelector('#score').textContent = `${possible}/100`;
  document.querySelector('#meter').style.width = `${possible}%`;
  const missing = rubricFields.filter(([key]) => !evaluation[key].ok).map(([, label]) => label);
  rubricFields.forEach(([key, , points]) => {
    const status = document.querySelector(`#field-status-${key}`);
    status.className = `field-status ${evaluation[key].ok ? 'accepted' : 'needs-work'}`;
    status.textContent = evaluation[key].ok ? `✓ Засчитано: +${points} баллов` : `0 баллов · ${evaluation[key].reason}`;
  });
  const next = nextLevel(possible);
  const quick = missingFields(rubric)[0];
  document.querySelector('#next-level').textContent = next ? `До уровня «${next.name}» осталось ${next.score - possible} баллов.` : 'Приоритетный уровень достигнут.';
  document.querySelector('#quick-win').textContent = quick ? `Следующее поле: ${quick[1]} (+${quick[2]} баллов после подтверждения).` : 'Все семь критериев засчитаны.';
  document.querySelector('#advice').textContent = `${level(possible)}. Засчитано ${7 - missing.length} из 7. ${missing.length ? 'Для роста рейтинга уточните: ' + missing.join(', ') + '.' : 'Все критерии засчитаны.'}${confirmed ? ' Карточка готова к публикации.' : ' Для публикации отметьте подтверждение выше.'}`;
}
function openForm(item = null) {
  const isDraft = item && !item.published;
  const values = item?.rubric || { context: item?.description || '' };
  const storageKey = localFormKey(item);
  const savedForm = readLocalForm(storageKey);
  showModal(`<div class="modal-head"><div><div class="eyebrow">${item ? 'Редактирование' : 'Новая задача'}</div><h2>Карточка бизнес задачи</h2><p>Начните со свободного описания и уточните детали.</p></div><button class="close" data-close>×</button></div>
    <div class="local-save-note" id="local-save-note" role="status"></div>
    <section class="ai-draft-box" aria-label="Помощник по созданию задачи"><h3>✦ Помощник по созданию задачи</h3><p>Опишите задачу своими словами. Помощник предложит поля и три вопроса. Вы сами выберете, что добавить в карточку.</p><div class="field"><label for="f-free">Свободное описание</label><textarea id="f-free" placeholder="Что происходит сейчас, какой результат нужен и что уже известно?">${html(item?.description || '')}</textarea></div><button class="secondary" id="make-ai-draft" type="button">Составить черновик</button><div id="ai-draft-error" class="form-error" role="alert" hidden></div><div id="ai-draft-preview" aria-live="polite"></div></section>
    <div class="field"><label for="f-title">Название задачи</label><input id="f-title" value="${html(item?.title || '')}" placeholder="Что нужно решить?"></div>
    ${rubricFields.map(([key, label, points, hint]) => `<div class="field"><label for="f-${key}">${label} · ${points} баллов</label><textarea id="f-${key}" placeholder="${html(hint)}">${html(values[key] || '')}</textarea><div id="field-status-${key}" class="field-status" aria-live="polite"></div></div>`).join('')}
    <div class="row"><div class="field"><label for="f-category">Тема</label><select id="f-category">${['Веб-разработка', 'Дизайн', 'Исследование'].map(c => `<option ${c === item?.category ? 'selected' : ''}>${c}</option>`).join('')}</select></div><div class="field"><label for="f-due">Срок</label><input id="f-due" value="${html(item?.due || '')}" placeholder="Например, 2 недели"></div></div>
    <div class="field"><label for="f-skills">Навыки команды</label><input id="f-skills" value="${html((item?.skills || []).join(', '))}" placeholder="Figma, React, интервью"></div>
    <label class="field" style="display:flex;gap:9px;align-items:flex-start"><input id="f-confirm" type="checkbox" style="width:auto;margin-top:3px"><span>Подтверждаю точность заполненных сведений и публикацию карточки.</span></label>
    <div class="scorebox"><div class="score-head"><span>Предварительный рейтинг</span><b id="score">0/100</b></div><div class="meter"><span id="meter" style="width:0%"></span></div><div class="game-sub" id="next-level"></div><div class="game-sub" id="quick-win"></div><div class="suggestion" id="advice" style="margin-top:8px"></div><button class="secondary" id="ask-questions" style="margin-top:12px">✦ Получить 3 уточняющих вопроса</button><div id="question-list"></div></div>
    <div class="modal-actions"><button class="secondary" id="save-draft">Сохранить черновик</button><button class="primary" id="publish">${item?.published ? 'Сохранить карточку' : 'Опубликовать'}</button></div>`);
  modal.dataset.kind = 'task';
  const saveLocal = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(captureLocalForm())); document.querySelector('#local-save-note').textContent = 'Изменения сохранены в этом браузере.'; }
    catch { document.querySelector('#local-save-note').textContent = 'Не удалось сохранить в браузере. Используйте «Сохранить черновик».'; }
  };
  if (savedForm) {
    restoreLocalForm(savedForm);
    document.querySelector('#local-save-note').innerHTML = 'Восстановлена незаконченная карточка из этого браузера. <button class="text-btn" id="discard-local" type="button">Начать заново</button>';
    document.querySelector('#discard-local').onclick = () => {
      localStorage.removeItem(storageKey);
      restoreLocalForm({ free: item?.description || '', title: item?.title || '', category: item?.category || 'Веб-разработка', due: item?.due || '', skills: item?.skills || [], rubric: values });
      document.querySelector('#local-save-note').textContent = 'Локальный черновик удалён. Новые изменения сохраняются автоматически.';
    };
  } else document.querySelector('#local-save-note').textContent = 'Изменения сохраняются в этом браузере автоматически.';
  modal.querySelectorAll('input,textarea,select').forEach(el => el.addEventListener('input', () => { if (el.id !== 'f-confirm') document.querySelector('#f-confirm').checked = false; updateScore(); saveLocal(); }));
  document.querySelector('#f-confirm').onchange = updateScore;
  document.querySelector('#make-ai-draft').onclick = async () => {
    const button = document.querySelector('#make-ai-draft'); button.disabled = true; button.textContent = 'Подготавливаем черновик…';
    const errorBox = document.querySelector('#ai-draft-error'); errorBox.hidden = true;
    try {
      const data = await api('/api/ai-draft', 'POST', { description: document.querySelector('#f-free').value,
        title: document.querySelector('#f-title').value, rubric: formValues().rubric });
      const candidates = [
        ...(data.title ? [{ key: 'title', label: 'Название задачи', value: data.title }] : []),
        ...rubricFields.filter(([key]) => data.rubric[key]).map(([key, label]) => ({ key, label, value: data.rubric[key] }))
      ];
      const preview = document.querySelector('#ai-draft-preview');
      preview.innerHTML = `<div class="ai-review"><b>${data.source === 'openai' ? 'Предложения OpenAI' : 'Демо черновик без OpenAI'}</b><div class="ai-note">${data.source === 'openai' ? 'Проверьте факты и выберите поля для добавления. Пустые поля ИИ оставил без догадок.' : 'Без API-ключа описание предложено только как контекст; остальные поля нужно уточнить.'}</div>${candidates.map(({ key, label, value }) => { const current = document.querySelector(key === 'title' ? '#f-title' : `#f-${key}`).value.trim(); return `<label class="ai-review-item"><input type="checkbox" data-ai-field="${key}" ${current ? '' : 'checked'}><div><b>${html(label)}</b><span>${html(value)}</span></div></label>`; }).join('') || '<div class="ai-note">Из описания пока нечего перенести. Дополните текст и попробуйте снова.</div>'}<button class="primary" id="apply-ai-draft" type="button" ${candidates.length ? '' : 'disabled'}>Добавить выбранное в карточку</button><div class="ai-note">Уточняющие вопросы:</div>${data.questions.map((q, i) => `<div class="ai-question"><b>${i + 1}. ${html(q.question)}</b><div class="field"><label for="ai-answer-${i}">Ваш ответ · ${html(rubricFields.find(([key]) => key === q.field)?.[1] || '')}</label><textarea id="ai-answer-${i}"></textarea></div></div>`).join('')}<button class="secondary" id="apply-ai-answers" type="button">Добавить ответы в карточку</button></div>`;
      document.querySelector('#apply-ai-draft').onclick = () => {
        preview.querySelectorAll('[data-ai-field]:checked').forEach(checkbox => {
          const value = candidates.find(candidate => candidate.key === checkbox.dataset.aiField)?.value;
          const field = document.querySelector(checkbox.dataset.aiField === 'title' ? '#f-title' : `#f-${checkbox.dataset.aiField}`);
          if (value && field) field.value = value;
        });
        document.querySelector('#f-confirm').checked = false; updateScore(); saveLocal(); toast('Выбранные предложения добавлены. Проверьте карточку перед публикацией.');
      };
      document.querySelector('#apply-ai-answers').onclick = () => {
        data.questions.forEach((question, i) => {
          const answer = document.querySelector(`#ai-answer-${i}`).value.trim();
          const field = document.querySelector(`#f-${question.field}`);
          if (answer && field) field.value = [field.value.trim(), answer].filter(Boolean).join('\n');
        });
        document.querySelector('#f-confirm').checked = false; updateScore(); saveLocal(); toast('Ответы добавлены. Проверьте их перед публикацией.');
      };
    } catch (error) { errorBox.textContent = `${error.message || 'Не удалось подготовить черновик.'} Ваш текст остался в форме; повторите запрос.`; errorBox.hidden = false; }
    finally { button.disabled = false; button.textContent = 'Составить черновик'; }
  };
  document.querySelector('#ask-questions').onclick = async () => {
    const button = document.querySelector('#ask-questions'); button.disabled = true;
    try {
      const data = await api('/api/questions', 'POST', formValues());
      document.querySelector('#question-list').innerHTML = `<div class="suggestion" style="margin-top:12px">${data.source === 'demo' ? 'Демо вопросы по незаполненным полям' : 'Вопросы OpenAI'}. Ответы можно проверить до публикации.</div>${data.questions.map((q, i) => `<div class="field"><label for="answer-${i}">${i + 1}. ${html(q.question)}</label><textarea id="answer-${i}"></textarea></div>`).join('')}<button class="secondary" id="apply-answers">Добавить ответы в карточку</button>`;
      document.querySelector('#apply-answers').onclick = () => {
        data.questions.forEach((q, i) => { const answer = document.querySelector(`#answer-${i}`).value.trim(); const field = document.querySelector(`#f-${q.field}`); if (answer && field) field.value = [field.value.trim(), answer].filter(Boolean).join('\n'); });
        document.querySelector('#f-confirm').checked = false; updateScore(); saveLocal(); toast('Ответы добавлены. Проверьте их и подтвердите карточку.');
      };
    } catch (error) {
      document.querySelector('#question-list').innerHTML = `<div class="form-error" role="alert">${html(error.message || 'Не удалось получить вопросы.')} Ваш текст остался в форме; повторите запрос.</div>`;
    } finally { button.disabled = false; }
  };
  document.querySelector('#save-draft').onclick = () => run(async () => {
    const value = formValues();
    await api('/api/drafts', 'POST', { id: isDraft ? item.id : undefined, title: value.title, category: value.category,
      description: value.rubric.context, rubric: value.rubric });
    localStorage.removeItem(storageKey);
    closeModal(); tab = 'my';
  }, 'Черновик сохранён.');
  let savedTask;
  document.querySelector('#publish').onclick = () => run(async () => {
    const value = formValues();
    savedTask = await api('/api/tasks', 'POST', { ...value, id: item?.published ? item.id : undefined, draftId: isDraft ? item.id : undefined,
      confirmed: document.querySelector('#f-confirm').checked });
    localStorage.removeItem(storageKey);
    closeModal(); tab = 'catalog'; filter = 'Все задачи'; levelFilter = 'Все уровни'; query = '';
  }, () => {
    const delta = item?.published ? savedTask.quality - item.quality : 0;
    const change = delta ? ` (${delta > 0 ? '+' : ''}${delta} баллов)` : '';
    const milestone = item?.published && level(item.quality) !== level(savedTask.quality) ? ` Новый уровень: ${level(savedTask.quality)}!` : '';
    const move = savedTask.lastChange?.previousRank && savedTask.lastChange.previousRank !== savedTask.lastChange.newRank
      ? ` Место в каталоге: №${savedTask.lastChange.previousRank} → №${savedTask.lastChange.newRank}.` : ` Место в каталоге: №${savedTask.lastChange?.newRank}.`;
    return `Карточка подтверждена: ${savedTask.quality}/100${change}.${milestone}${move}`;
  });
  updateScore();
}

function openProposalForm(task) {
  showModal(`<div class="modal-head"><div><div class="eyebrow">${html(teamName(teamId))}</div><h2>Предложить решение</h2><p>${html(task.title)}</p></div><button class="close" data-close>×</button></div>
    <div class="field"><label for="p-idea">Идея решения</label><textarea id="p-idea"></textarea></div><div class="field"><label for="p-plan">План работы</label><textarea id="p-plan"></textarea></div><div class="row"><div class="field"><label for="p-due">Срок</label><input id="p-due" placeholder="Например, 10 дней"></div><div class="field"><label for="p-link">Ссылка на прототип или материалы</label><input id="p-link" placeholder="https://..."></div></div><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="send-proposal">Отправить</button></div>`);
  document.querySelector('#send-proposal').onclick = () => run(async () => {
    await api('/api/proposals', 'POST', { taskId: task.id, teamId, idea: document.querySelector('#p-idea').value,
      plan: document.querySelector('#p-plan').value, due: document.querySelector('#p-due').value, link: document.querySelector('#p-link').value });
    closeModal();
  }, 'Предложение отправлено заказчику.');
}
function openProposals(taskId) {
  const task = state.tasks.find(t => String(t.id) === String(taskId));
  const list = proposalsFor(taskId);
  showModal(`<div class="modal-head"><div><div class="eyebrow">${html(task.title)}</div><h2>Предложения команд</h2><p>Можно выбрать несколько команд или оставить все без выбора.</p></div><button class="close" data-close>×</button></div>
    <div class="small">Выбрано ${list.filter(p => p.status === 'selected').length} из ${list.length}</div>${list.map(p => {
      const stages = p.stages || [];
      const canComplete = p.status === 'selected' && !p.completedAt && stages.some(stage => stage.status === 'confirmed') && !stages.some(stage => stage.status === 'pending');
      const canChangeSelection = !p.completedAt && !stages.length;
      return `<article class="card" style="margin:12px 0;padding:16px;box-shadow:none"><div class="card-top"><b>${html(teamName(p.teamId))}</b><span class="status ${p.status === 'selected' ? 'selected' : ''}">${p.completedAt ? 'Завершено' : p.status === 'selected' ? 'Выбрано' : p.status === 'rejected' ? 'Отклонено' : 'Ожидает'}</span></div><p><b>Идея:</b> ${html(p.idea)}</p><p><b>План:</b> ${html(p.plan)}</p><div class="small">Срок: ${html(p.due)} ${p.link ? `· <a href="${html(p.link)}" target="_blank" rel="noopener noreferrer">Материалы</a>` : ''} · ${proposalXP(p)} XP</div>${stages.map((stage, i) => `<div class="scorebox"><b>Этап ${i + 1}:</b> ${html(stage.description)}<div class="small">${stage.status === 'confirmed' ? 'Подтверждён, +10 XP' : 'Ожидает подтверждения'}</div>${stage.link ? `<a href="${html(stage.link)}" target="_blank" rel="noopener noreferrer">Результат</a>` : ''}${p.status === 'selected' && !p.completedAt && stage.status === 'pending' ? `<div class="modal-actions"><button class="primary" data-action="confirm-stage" data-id="${html(p.id)}" data-stage-id="${html(stage.id)}">Подтвердить этап</button></div>` : ''}</div>`).join('')}${p.completedAt ? '<div class="small">Работа завершена · бонус +30 XP</div>' : ''}<div class="modal-actions">${canChangeSelection ? `<button class="secondary" data-action="reject" data-id="${html(p.id)}">Отклонить</button><button class="primary" data-action="${p.status === 'selected' ? 'unselect' : 'select'}" data-id="${html(p.id)}">${p.status === 'selected' ? 'Снять выбор' : 'Выбрать'}</button>` : ''}${canComplete ? `<button class="primary" data-action="complete-task" data-id="${html(p.id)}">Завершить работу · +30 XP</button>` : ''}</div></article>`;
    }).join('') || '<div class="empty">Предложений пока нет.</div>'}<div class="modal-actions"><button class="secondary" data-close>Закрыть</button></div>`);
  document.querySelectorAll('[data-action]').forEach(b => b.onclick = () => run(async () => {
    await api(`/api/proposals/${encodeURIComponent(b.dataset.id)}`, 'PATCH', { action: b.dataset.action, stageId: b.dataset.stageId });
    closeModal();
  }, b.dataset.action === 'confirm-stage' ? 'Этап подтверждён. Команда получила 10 XP.' : b.dataset.action === 'complete-task' ? 'Работа завершена. Команда получила ещё 30 XP.' : 'Решение сохранено.'));
}
function openStageForm(proposal) {
  showModal(`<div class="modal-head"><div><div class="eyebrow">Отчёт команды</div><h2>Показать выполненный этап</h2><p>10 XP появятся после подтверждения заказчиком.</p></div><button class="close" data-close>×</button></div><div class="field"><label for="stage-description">Что выполнено</label><textarea id="stage-description"></textarea></div><div class="field"><label for="stage-link">Ссылка на результат</label><input id="stage-link" placeholder="https://..."></div><div class="modal-actions"><button class="secondary" data-close>Отмена</button><button class="primary" id="send-stage">Отправить на подтверждение</button></div>`);
  document.querySelector('#send-stage').onclick = () => run(async () => {
    await api(`/api/proposals/${encodeURIComponent(proposal.id)}`, 'PATCH', { action: 'submit-stage',
      description: document.querySelector('#stage-description').value, link: document.querySelector('#stage-link').value });
    closeModal();
  }, 'Этап отправлен заказчику.');
}

document.querySelectorAll('[data-role]').forEach(b => b.onclick = () => { role = b.dataset.role; localStorage.setItem('hackalem-role', role); tab = 'catalog'; render(); });
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
try {
  await refresh(true);
  const status = await api('/api/status');
  const badge = document.querySelector('#ai-status');
  badge.className = `ai-status ${status.mode === 'openai' ? 'ready' : 'missing'}`;
  badge.textContent = status.mode === 'openai' ? 'Ключ OpenAI задан' : 'Демо вопросы';
  badge.title = status.mode === 'openai' ? `Запросы к OpenAI · модель: ${status.model}` : 'Для OpenAI добавьте ключ в .env. Без ключа работают локальные вопросы.';
  setInterval(() => refresh().catch(() => {}), 4000);
} catch (error) {
  app.innerHTML = `<div class="empty">Не удалось загрузить каталог: ${html(error.message)}. Запустите сервер и обновите страницу.</div>`;
  const badge = document.querySelector('#ai-status'); badge.className = 'ai-status offline'; badge.textContent = 'Сервер недоступен';
}
