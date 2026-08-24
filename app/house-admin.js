import { esc, html, formatDate } from './ui.js';

/**
 * Управление жизнью дома: объявления и опросы.
 *
 * Общий модуль для двух кабинетов — УК и председателя совета дома. Формы
 * у них одинаковые, разница только в области видимости: УК выбирает дом
 * из списка своих, у председателя дом ровно один и выбирать нечего.
 *
 * Держать это в двух копиях нельзя: расходятся не стили, а правила —
 * например, обязательность срока у аварийного объявления. Разъехавшись,
 * два кабинета начнут публиковать разное в одну и ту же ленту.
 */

export const POST_KINDS = [
  {
    value: 'outage',
    label: 'Отключение',
    hint: 'Уведомление уйдёт всем жильцам дома. Только для аварий и плановых отключений.',
  },
  { value: 'meeting', label: 'Собрание', hint: 'Появится в ленте дома, без уведомления.' },
  { value: 'news', label: 'Новость', hint: 'Появится в ленте дома, без уведомления.' },
];

/**
 * Форма объявления.
 *
 * `houses` — список домов на выбор (у председателя пустой: дом один).
 */
export function postForm({ houses = [], houseLabel = '' } = {}) {
  return html`
    <div class="dsp-card">
      <h2>Новое объявление дома</h2>

      ${houses.length
        ? html`
          <div class="field-label" style="margin-top:0">Дом</div>
          <select id="haHouse" class="dsp-select">
            ${houses.map((h) => `<option value="${esc(h.houseKey)}">${esc(h.label)}</option>`).join('')}
          </select>`
        : `<div class="dsp-hint" style="margin-top:0">Дом: ${esc(houseLabel)}</div>`}

      <div class="field-label">Тип</div>
      <div class="chips" id="haKind">
        ${POST_KINDS.map((k, i) => html`
          <span class="chip ${i === 0 ? 'sel' : ''}" data-action="ha-kind"
                data-v="${esc(k.value)}" data-hint="${esc(k.hint)}">${esc(k.label)}</span>
        `).join('')}
      </div>
      <div class="dsp-hint" id="haKindHint">${esc(POST_KINDS[0].hint)}</div>

      <div class="field-label">Заголовок</div>
      <input type="text" id="haTitle" placeholder="Например: отключение холодной воды">

      <div class="field-label">Текст</div>
      <textarea id="haBody" placeholder="Что происходит, где и что делать жильцам"></textarea>

      <div class="field-label">Актуально до</div>
      <input type="datetime-local" id="haExpires">
      <div class="dsp-hint">
        После этого времени объявление перестанет висеть на главном экране
        жителя. Без срока «нет воды до 18:00» остаётся там навсегда —
        у собрания и новости срок можно не ставить.
      </div>

      <div class="dsp-actions" style="margin-top:16px">
        <button class="dsp-act primary" data-action="ha-publish">Опубликовать</button>
      </div>
    </div>`;
}

/** Собрать данные формы объявления. Возвращает null, если не заполнено. */
export function readPostForm() {
  const title = document.querySelector('#haTitle')?.value.trim() ?? '';
  const body = document.querySelector('#haBody')?.value.trim() ?? '';
  const category = document.querySelector('#haKind .chip.sel')?.dataset.v ?? 'news';
  const rawExpires = document.querySelector('#haExpires')?.value ?? '';
  const houseKey = document.querySelector('#haHouse')?.value;

  if (title.length < 3 || body.length < 5) return null;

  return {
    houseKey,
    category,
    title,
    body,
    // datetime-local отдаёт местное время без зоны — доверяем браузеру
    expiresAt: rawExpires ? new Date(rawExpires).toISOString() : undefined,
  };
}

export function postList(posts) {
  if (posts.length === 0) {
    return '<div class="dsp-empty">Объявлений пока нет</div>';
  }

  return html`
    <div class="dsp-card">
      <h2>Опубликованные объявления</h2>
      <div class="ha-list">
        ${posts.map((p) => html`
          <div class="ha-row ${p.removed ? 'off' : ''}">
            <div>
              <div class="ha-t">${esc(p.title)}</div>
              <div class="ha-d">
                ${esc(p.categoryLabel)} · ${esc(p.author)} · ${esc(formatDate(p.publishedAt))}
                ${p.expiresAt ? ` · до ${esc(formatDate(p.expiresAt))}` : ''}
              </div>
            </div>
            <div class="ha-state">${stateLabel(p)}</div>
            ${p.removed
              ? '<span></span>'
              : html`<button class="dsp-act danger" data-action="ha-remove" data-id="${esc(p.id)}">
                       Снять
                     </button>`}
          </div>`).join('')}
      </div>
    </div>`;
}

/**
 * Состояние объявления словами.
 *
 * «На главном экране» — только у действующего отключения: баннер наверху
 * приложения показывает именно их. Собрание и новость живут в ленте, и
 * обещать им место на главном экране было бы неправдой.
 */
function stateLabel(p) {
  if (p.removed) return '<span class="pill">снято</span>';
  if (p.expired) return '<span class="pill">срок вышел</span>';
  if (p.category === 'outage') return '<span class="pill ok">на главном экране</span>';
  return '<span class="pill ok">в ленте дома</span>';
}

export function pollForm() {
  return html`
    <div class="dsp-card">
      <h2>Новый опрос дома</h2>
      <div class="dsp-hint" style="margin-top:0">
        Это опрос, а не общее собрание собственников: голоса считаются по
        людям, а не по долям, и юридической силы у результата нет.
      </div>

      <div class="field-label">Вопрос</div>
      <input type="text" id="hpTitle" placeholder="Например: ставим ли шлагбаум на въезде">

      <div class="field-label">Пояснение</div>
      <textarea id="hpDesc" placeholder="Зачем спрашиваем и что будет с результатом"></textarea>

      <div class="field-label">Варианты ответа, по одному в строке</div>
      <textarea id="hpOptions" placeholder="За&#10;Против&#10;Воздержался"></textarea>

      <div class="field-label">Голосование до</div>
      <input type="datetime-local" id="hpCloses">

      <div class="dsp-actions" style="margin-top:16px">
        <button class="dsp-act primary" data-action="hp-create">Запустить опрос</button>
      </div>
    </div>`;
}

export function readPollForm() {
  const title = document.querySelector('#hpTitle')?.value.trim() ?? '';
  const options = (document.querySelector('#hpOptions')?.value ?? '')
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);
  const rawCloses = document.querySelector('#hpCloses')?.value ?? '';

  if (!title || options.length < 2) return null;

  return {
    title,
    description: document.querySelector('#hpDesc')?.value.trim() || undefined,
    options,
    closesAt: rawCloses ? new Date(rawCloses).toISOString() : undefined,
  };
}

export function pollList(polls) {
  if (polls.length === 0) return '<div class="dsp-empty">Опросов пока нет</div>';

  return html`
    <div class="dsp-card">
      <h2>Опросы дома</h2>
      <div class="ha-list">
        ${polls.map((p) => html`
          <div class="ha-row">
            <div>
              <div class="ha-t">${esc(p.title)}</div>
              <div class="ha-d">
                ${p.closed ? 'завершён' : 'идёт'} ·
                проголосовало ${esc(p.total)} ·
                ${p.byChairman ? 'от председателя' : 'от УК'}
              </div>
              <div class="ha-bars">
                ${p.options.map((o) => html`
                  <div class="ha-bar">
                    <span class="l">${esc(o.text)}</span>
                    <span class="track"><span class="fill"
                      style="width:${p.total ? Math.round((o.votes / p.total) * 100) : 0}%"></span></span>
                    <span class="n">${esc(o.votes)}</span>
                  </div>`).join('')}
              </div>
            </div>
            <span></span><span></span>
          </div>`).join('')}
      </div>
    </div>`;
}
