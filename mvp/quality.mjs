export const weights = { context: 20, materials: 20, result: 15, criteria: 15, constraints: 10, users: 10, contact: 10 };

const prompts = {
  context: 'Опишите, что происходит сейчас и какую проблему нужно решить.',
  materials: 'Назовите конкретные данные, примеры или материалы для команды.',
  result: 'Опишите конкретный результат, который команда должна передать.',
  criteria: 'Укажите, по каким признакам заказчик примет результат.',
  constraints: 'Уточните срок, условия работы или ограничения.',
  users: 'Назовите группу людей, для которых нужно решение.',
  contact: 'Укажите человека или канал для обратной связи.'
};

const filler = new Set(['не', 'знаю', 'пока', 'нет', 'данных', 'позже', 'уточнить', 'уточняется', 'будет', 'тест', 'тестовый', 'тестовая', 'задача', 'н', 'д', 'tbd', 'todo', 'lorem', 'ipsum',
  'кейін', 'жоқ', 'белгісіз', 'анықтаймыз', 'әзірше', 'мәлімет', 'білмеймін',
  'i', 'do', 'not', 'don', 't', 'know', 'no', 'data', 'yet', 'later', 'unknown', 'none', 'test', 'example', 'placeholder', 'to', 'be', 'determined']);

export function evaluateField(key, value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, reason: prompts[key] || 'Заполните поле.' };
  const words = text.toLocaleLowerCase('ru').match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length === 0 || words.every(word => filler.has(word))) {
    return { ok: false, reason: 'Замените заглушку конкретным ответом.' };
  }
  if (key === 'contact' && /[\w.+-]+@[\w.-]+\.[a-z]{2,}|@[\w.]{3,}/i.test(text)) return { ok: true, reason: '' };
  if (words.length < 2 || text.replace(/\s/g, '').length < 10) {
    return { ok: false, reason: prompts[key] || 'Добавьте конкретики.' };
  }
  return { ok: true, reason: '' };
}

export function evaluateRubric(rubric = {}) {
  return Object.fromEntries(Object.keys(weights).map(key => [key, evaluateField(key, rubric[key])]));
}

export function score(rubric = {}) {
  const evaluation = evaluateRubric(rubric);
  return Object.keys(weights).reduce((total, key) => total + (evaluation[key].ok ? weights[key] : 0), 0);
}
