import { api } from '../api.js';
import { platform } from '../platform.js';
import {
  esc, html, formatDate, loadingState, errorState, emptyState, toast, withLoading, eventAuthor,
} from '../ui.js';
import { wipNote } from '../wip.js';

/**
 * Заявки: список, деталка с историей, форма создания.
 *
 * Срок реакции показываем везде, где показываем статус. Житель должен
 * понимать, когда ждать мастера, — иначе он всё равно позвонит в УК,
 * и приложение не снимет с них ни одного звонка.
 */

const CATEGORIES = [
  'Авария', 'Сантехника', 'Электрика', 'Лифт', 'Общее имущество', 'Другое',
];

const SLA_TONE = { ok: '', soon: 'warn', overdue: 'bad' };

export function requestsSkeleton() {
  return `<div class="page active" id="page-requests">${loadingState('Загружаем обращения…')}</div>`;
}

export async function renderRequests(state) {
  let data;
  try {
    // Обращения принадлежат квартире — показываем только активную
    data = await api.requests(state?.currentProperty?.propertyId);
  } catch (error) {
    return errorState(error, 'requests');
  }

  const tab = window.__reqTab ?? 'active';
  const list = tab === 'active' ? data.active : data.archive;

  return html`
    <div class="tabs" style="padding:0 0 12px">
      <span class="tab ${tab === 'active' ? 'on' : ''}" data-action="req-tab" data-tab="active">
        Активные · ${data.active.length}
      </span>
      <span class="tab ${tab === 'archive' ? 'on' : ''}" data-action="req-tab" data-tab="archive">
        Архив · ${data.archive.length}
      </span>
    </div>

    ${list.length
      ? `<div class="list">${list.map(row).join('')}</div>`
      : emptyState(
          tab === 'active' ? 'Активных обращений нет' : 'Архив пуст',
          tab === 'active'
            ? 'Новые заявки появятся здесь сразу после отправки'
            : 'Выполненные и отклонённые обращения будут здесь',
        )}

    <button class="btn-primary" data-action="complaint">Новое обращение</button>
  `;
}

function row(r) {
  const tone = r.status === 'done' ? 'ok' : r.status === 'new' ? 'new'
    : r.status === 'rejected' ? 'bad' : '';

  /**
   * «Нужны уточнения» в списке выглядел ровно как «в работе», и заявка
   * молча стояла: житель не знал, что ход за ним. Поэтому вторая строка
   * говорит прямо, что от него ждут ответа.
   */
  const sub = r.awaitingResident
    ? 'Диспетчер ждёт вашего ответа'
    : `№ ${esc(r.number)} · ${esc(r.category)}`;

  return html`
    <button class="wrow tappable" data-action="request" data-id="${esc(r.id)}">
      <span class="sq ${r.awaitingResident ? '' : tone}">${statusIcon(r.status, r.awaitingResident)}</span>
      <div class="content">
        <div class="t">${esc(r.title)}</div>
        <div class="d ${r.awaitingResident ? 'ask' : ''}">${sub}</div>
      </div>
      <span class="pill ${tone}">${esc(r.statusLabel)}</span>
    </button>`;
}

function statusIcon(status, awaiting) {
  if (awaiting) {
    return '<svg viewBox="0 0 20 20" fill="none"><path d="M10 3.2C6.3 3.2 3.3 5.7 3.3 8.8C3.3 10.6 4.3 12.2 5.9 13.2L5.2 16L8.2 14.3C8.8 14.4 9.4 14.5 10 14.5C13.7 14.5 16.7 12 16.7 8.8C16.7 5.7 13.7 3.2 10 3.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  }
  if (status === 'done') {
    return '<svg viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5L8.2 14.2L15.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  if (status === 'rejected') {
    return '<svg viewBox="0 0 20 20" fill="none"><path d="M5.5 5.5L14.5 14.5M14.5 5.5L5.5 14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  }
  return '<svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.6"/><path d="M10 6V10.2L12.8 11.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

/* ─────────────── деталка ─────────────── */

export async function renderRequestDetail(id) {
  let r;
  try {
    r = await api.request(id);
  } catch (error) {
    return errorState(error, 'requests');
  }

  const closed = r.closed ?? (r.status === 'done' || r.status === 'rejected');
  const question = lastQuestion(r);

  return html`
    <div class="dt-title">${esc(r.title)}</div>
    <div class="dt-meta">№ ${esc(r.number)} · ${esc(r.category)}</div>

    <div class="dt-card">
      <div class="dt-status">
        <span class="pill ${statusTone(r.status)}">${esc(r.statusLabel)}</span>
      </div>
      ${r.status === 'rejected'
        // Отклонённой заявке трек не рисуем: три точки «принято → в работе →
        // выполнено» с закрашенным концом читаются как «сделано», а это ложь
        ? '<div class="dt-p" style="margin-top:10px">Заявка закрыта без выполнения. Причина — ниже.</div>'
        : html`
          ${track(r.status)}
          <div class="track-labels">
            <span>принято</span>
            <span>${r.status === 'need_info' ? 'нужны уточнения' : 'в работе'}</span>
            <span>выполнено</span>
          </div>`}
      ${!closed && r.slaLabel ? `
        <div class="sla ${SLA_TONE[r.sla] ?? ''}">
          ${r.sla === 'overdue' ? 'Срок вышел' : 'Срок реакции'} · ${esc(r.slaLabel)}
        </div>` : ''}
    </div>

    ${r.awaitingResident ? html`
      <div class="ask-card">
        <div class="ask-h">Диспетчер ждёт вашего ответа</div>
        ${question ? `<div class="ask-q">${esc(question)}</div>` : ''}
        <div class="ask-d">
          Пока вы не ответите, заявка не двинется — срок реакции идёт,
          но сделать по ней нечего.
        </div>
      </div>` : ''}

    ${r.assigneeName ? `
      <div class="field-label">Мастер</div>
      <div class="list"><div class="row">
        <span class="sq new"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7.5" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 17C4.5 13.8 7 12.4 10 12.4C13 12.4 15.5 13.8 15.5 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>
        <div class="content"><div class="t">${esc(r.assigneeName)}</div><div class="d">назначен диспетчером</div></div>
      </div></div>` : ''}

    ${r.masterSlotStart ? `
      <div class="field-label">Удобное время</div>
      <div class="dt-card" style="margin-top:0">
        <div class="dt-p" style="margin-top:0">${esc(slotText(r))}</div>
      </div>` : ''}

    ${r.rejectReason ? `
      <div class="field-label">Почему отклонено</div>
      <div class="dt-card"><div class="dt-p" style="margin-top:0">${esc(r.rejectReason)}</div></div>` : ''}

    <div class="field-label">Описание</div>
    <div class="dt-card" style="margin-top:0">
      <div class="dt-p" style="margin-top:0">${esc(r.description)}</div>
    </div>

    ${r.photos?.length ? html`
      <div class="field-label">Вложения</div>
      <div class="list">
        ${r.photos.map((f) => html`
          <button class="row tappable" data-action="open-file" data-url="${esc(f.url)}">
            <span class="sq">
              ${f.mime?.startsWith('image/')
                ? '<svg viewBox="0 0 20 20" fill="none"><rect x="2.5" y="4" width="15" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="8.5" r="1.4" fill="currentColor"/><path d="M3 14L7.5 10.5L11 13L13.5 11L17 14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
                : '<svg viewBox="0 0 20 20" fill="none"><path d="M5 2.5h6.5L15 6v11.5H5V2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M11.5 2.5V6H15" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'}
            </span>
            <div class="content">
              <div class="t">${esc(f.name)}</div>
              <div class="d">
                ${esc(fileSize(f.sizeBytes))}${f.byDispatcher ? ' · от управляющей компании' : ''}
              </div>
            </div>
            <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </button>`).join('')}
      </div>` : ''}

    <div class="field-label">Переписка по заявке</div>
    <div class="dt-card" style="margin-top:0">
      <div class="timeline">
        ${r.events.map((e) => html`
          <div class="tl-row ${e.actor === 'resident' ? 'mine' : ''}">
            <div class="tl-dot-col"><div class="tl-dot"></div><div class="tl-line"></div></div>
            <div class="tl-body">
              <div class="tl-who">${esc(eventAuthor(e))}</div>
              <div class="tl-t">${esc(e.text)}</div>
              <div class="tl-time">${esc(formatDate(e.at))}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <!--
      ГЛАВНАЯ ЦЕННОСТЬ ПРОДУКТА, которую надо назвать вслух.
      Архив УК неудаляемый по построению: маршрута удаления заявки
      не существует, диспетчер может только менять статус. Но пока
      об этом не сказано, житель об этом не знает — а ставит приложение
      он ровно ради этого.
    -->
    <div class="dt-card" style="background:var(--fade)">
      <div class="dt-p" style="margin-top:0;font-size:13px;color:var(--tx-2)">
        <b>Это обращение нельзя удалить.</b> Управляющая компания может
        изменить статус или отклонить его с объяснением, но запись
        и вся переписка останутся в её архиве и у вас.
      </div>
    </div>

    ${closed ? html`
      <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
        Заявка закрыта — дописать в неё нельзя. Если проблема вернулась,
        заведите новую: срок реакции пойдёт заново.
      </div>`
      : html`
      <div class="field-label">${r.awaitingResident ? 'Ваш ответ' : 'Дополнить заявку'}</div>
      <textarea id="reqReply" placeholder="${r.awaitingResident
        ? 'Ответьте диспетчеру'
        : 'Что-то изменилось или забыли уточнить — напишите здесь'}"></textarea>
      <div class="field-error" id="reqReplyErr"></div>
      <button class="btn-primary" data-action="send-comment" data-id="${esc(r.id)}">
        Отправить диспетчеру
      </button>`}

    ${r.status === 'done' ? ratingBlock(r) : ''}

    <div class="field-label">Связь по заявке</div>
    <div class="list">
      <button class="row tappable" data-action="call" data-phone="+7 (495) 123-45-67">
        <span class="sq new"><svg viewBox="0 0 20 20" fill="none"><path d="M4 4.5C4 4 4.5 3.2 5.2 3.2H7L8.2 6.8L6.5 8C7.2 9.8 9 11.8 10.8 12.5L12 10.8L15.6 12V13.8C15.6 14.5 15 15 14.3 15C8.6 15 4 10.4 4 4.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span>
        <div class="content">
          <div class="t">Позвонить диспетчеру</div>
          <div class="d">+7 (495) 123-45-67 · будни 8:00–20:00</div>
        </div>
      </button>
    </div>`;
}

function statusTone(status) {
  if (status === 'done') return 'ok';
  if (status === 'new') return 'new';
  if (status === 'rejected') return 'bad';
  return '';
}

/** Окно приёма мастера: «21 августа, 13:00–18:00». */
export function slotText(r) {
  if (!r.masterSlotStart) return '';
  const start = new Date(r.masterSlotStart);
  const end = r.masterSlotEnd ? new Date(r.masterSlotEnd) : null;
  const day = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const hhmm = (d) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return end ? `${day}, ${hhmm(start)}–${hhmm(end)}` : `${day}, ${hhmm(start)}`;
}

/** Последний вопрос диспетчера — его показываем прямо в баннере. */
function lastQuestion(r) {
  const found = [...(r.events ?? [])].reverse().find((e) => e.actor === 'dispatcher');
  return found?.text ?? null;
}

function track(status) {
  const stage = status === 'new' ? 0
    : status === 'in_work' || status === 'need_info' ? 1
    : 2;
  const dot = (i) => i < stage ? 'done' : i === stage ? 'on' : '';
  const seg = (i) => i < stage ? 'done' : '';
  return html`
    <div class="track">
      <div class="pt ${dot(0)}"></div><div class="seg ${seg(0)}"></div>
      <div class="pt ${dot(1)}"></div><div class="seg ${seg(1)}"></div>
      <div class="pt ${dot(2)}"></div>
    </div>`;
}

function ratingBlock(r) {
  if (r.rating) {
    return html`
      <div class="field-label">Ваша оценка</div>
      <div class="dt-card" style="margin-top:0;display:flex;align-items:center;gap:12px">
        <div class="stars readonly">${stars(r.rating.stars)}</div>
        <span style="font-size:14px;color:var(--tx-2)">Спасибо за оценку</span>
      </div>`;
  }
  return html`
    <div class="field-label">Оцените выполнение</div>
    <div class="dt-card" style="margin-top:0">
      <div class="stars" id="rateStars">
        ${[1, 2, 3, 4, 5].map((n) => html`
          <span class="star" data-action="rate" data-id="${esc(r.id)}" data-stars="${n}">${starSvg()}</span>
        `).join('')}
      </div>
    </div>`;
}

function stars(value) {
  return [1, 2, 3, 4, 5]
    .map((n) => `<span class="star ${n <= value ? 'on' : ''}">${starSvg()}</span>`)
    .join('');
}

const starSvg = () =>
  '<svg width="24" height="24" viewBox="0 0 22 22" fill="none"><path d="M11 2L13.5 8.2L20 8.7L15 12.9L16.6 19.3L11 15.8L5.4 19.3L7 12.9L2 8.7L8.5 8.2L11 2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="currentColor" fill-opacity="0"/></svg>';

/* ─────────────── форма создания ─────────────── */

/**
 * Окна приёма мастера на ближайшие дни.
 *
 * Раньше здесь была пустая полоса под заголовком «Когда удобно принять
 * мастера»: поля в базе и в API есть, а выбрать было нечего. Житель
 * оставался без ответа на главный для него вопрос — когда сидеть дома.
 *
 * Окна крупные и с запасом: обещать «мастер в 14:20» УК не может, а
 * промах по обещанию хуже широкого окна.
 */
function masterSlots(now = new Date()) {
  const WINDOWS = [
    { fromHour: 9, toHour: 13, label: '9:00–13:00' },
    { fromHour: 13, toHour: 18, label: '13:00–18:00' },
    { fromHour: 18, toHour: 21, label: '18:00–21:00' },
  ];
  const DAYS = ['сегодня', 'завтра', 'послезавтра'];

  const slots = [];
  for (const [offset, dayLabel] of DAYS.entries()) {
    for (const w of WINDOWS) {
      const start = new Date(now);
      start.setDate(start.getDate() + offset);
      start.setHours(w.fromHour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(w.toHour, 0, 0, 0);

      // Окно, которое уже началось, предлагать нечестно
      if (start.getTime() <= now.getTime()) continue;
      slots.push({ start, end, label: `${dayLabel} ${w.label}` });
    }
  }
  return slots.slice(0, 6);
}


/**
 * Размер файла человеческими словами.
 *
 * «0 КБ» у маленькой картинки читается как ошибка загрузки, поэтому
 * всё, что меньше килобайта, называем прямо.
 */
function fileSize(bytes) {
  const size = Number(bytes ?? 0);
  if (size < 1024) return 'меньше 1 КБ';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

/**
 * Кто увидит обращение — называем всех, а не только главного адресата.
 *
 * Право читать обращения дома и отвечать в переписке дано председателю
 * ПО ВСЕМУ ДОМУ, включая дома с управляющей компанией, — а строка ниже
 * раньше показывалась только при её отсутствии. Получалось зеркало той
 * же неправды, которую эта же работа чинила: раньше приложение обещало
 * доступ, которого не было, теперь есть доступ, о котором молчат. Человек
 * пишет жалобу на соседа сверху, считая адресатом только УК, — а прочитает
 * её ещё и совет дома, возможно, тот самый сосед.
 */
function addresseeLine(hm) {
  if (!hm) return '';

  if (hm.orgName && hm.hasChairman) {
    return html`<div class="warn-line" style="margin-top:2px">
        Обращение увидят управляющая компания «${esc(hm.orgName)}» и совет дома.
      </div>`;
  }
  if (hm.hasChairman) {
    return html`<div class="warn-line" style="margin-top:2px">
        Обращение увидит совет дома: управляющей компании у вашего дома нет.
      </div>`;
  }
  if (hm.orgName) {
    // УК есть, председателя нет — тут и раньше было нечего добавить:
    // единственный адресат ясен без отдельной строки
    return '';
  }
  return html`<div class="warn-line" style="margin-top:2px">
      Адресата пока нет — за домом никто не закреплён. Запись сохранится
      с датой и никуда не денется: её увидит тот, кто возьмётся за дом.
    </div>`;
}

export function renderComplaintForm(state, kind = 'complaint') {
  const property = state.currentProperty;
  const isMaster = kind === 'master';

  /**
   * Форма НЕ закрывается никогда.
   *
   * Раньше отсутствие УК закрывало её совсем, и ядро продукта — жалоба
   * с датой, которую нельзя удалить, — было недоступно ровно тем домам,
   * у которых нет управляющей компании: ТСЖ, непосредственное
   * управление, частные дома. Доказательство нужно человеку и тогда,
   * когда прочитать жалобу сегодня некому.
   */
  const addressee = addresseeLine(property?.houseManagement);

  /**
   * Порядок строк: сначала «что это за функция сегодня», потом «кто увидит
   * ваше обращение». Второе бессмысленно читать раньше первого.
   */
  return html`
    ${isMaster ? wipNote('master') : ''}
    ${addressee}
    <div class="field-label" style="margin-top:2px">Категория</div>
    <div class="chips" id="catChips">
      ${CATEGORIES.map((c, i) => html`
        <span class="chip ${i === 1 ? 'sel' : ''}" data-action="pick-cat" data-v="${esc(c)}">${esc(c)}</span>
      `).join('')}
    </div>

    <div class="field-label">Адрес</div>
    <div class="readonly-field">${esc(property?.addressRaw ?? '')}</div>

    <div class="field-label">Опишите проблему</div>
    <textarea id="reqDesc" placeholder="Например: течёт труба под раковиной на кухне, вода идёт на пол"></textarea>
    <div class="field-error" id="reqDescErr"></div>

    ${isMaster ? html`
      <div class="field-label">Когда удобно принять мастера</div>
      <div class="chips" id="slotChips">
        ${masterSlots().map((s) => html`
          <span class="chip" data-action="pick-slot"
                data-start="${esc(s.start.toISOString())}"
                data-end="${esc(s.end.toISOString())}">${esc(s.label)}</span>
        `).join('')}
      </div>
      <div class="dt-p" style="font-size:13px;color:var(--tx-2);margin-top:10px">
        Окно не обязательно — это пожелание, которое диспетчер увидит вместе
        с заявкой. Точное время он согласует с вами сам, вне приложения.
      </div>
    ` : ''}

    <div class="field-label">Фотографии и документы</div>
    <label class="btn-primary secondary" style="cursor:pointer;display:block;text-align:center">
      Прикрепить файл
      <input type="file" id="reqFiles" hidden multiple
             accept="image/*,application/pdf" data-action="pick-files">
    </label>
    <div id="reqFilesList" class="dt-p" style="font-size:13px;color:var(--tx-2)">
      Фотография протечки или скан акта помогают диспетчеру больше, чем
      описание. Можно приложить до пяти файлов, каждый до 10 МБ.
    </div>

    <div class="dt-p">
      Срок реакции зависит от категории: аварии — 2 часа, сантехника
      и электрика — сутки, остальное — трое суток.
    </div>

    <button class="btn-primary" id="reqSubmit" data-action="submit-request" data-kind="${esc(kind)}">
      ${isMaster ? 'Вызвать мастера' : 'Отправить обращение'}
    </button>`;
}

/**
 * Часы по-русски: 2 часа, 8 часов, 24 часа, 72 часа.
 *
 * Прежняя формула «меньше пяти — часа, иначе часов» давала «24 часов»
 * ровно там, где житель читает срок реакции по своей заявке.
 */
function hoursWord(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'часов';
  const mod10 = n % 10;
  if (mod10 === 1) return 'час';
  if (mod10 >= 2 && mod10 <= 4) return 'часа';
  return 'часов';
}

/**
 * Что сказать о судьбе обращения — та же цепочка «кто увидит», что решает
 * строку адресата на форме (addresseeLine), только в прошедшем времени
 * и с обещанием, которое приложение способно сдержать.
 *
 * Раньше текст был один на все три случая: «диспетчер увидит сразу, статус
 * придёт уведомлением» — сразу после формы, которая честно говорила
 * «адресата пока нет». У дома без организации диспетчера не существует,
 * статус не поменяет никто, и уведомление никогда не придёт.
 */
function successText(hm, slaHours, word) {
  if (hm?.orgName) {
    return `Диспетчер увидит заявку сразу. Срок реакции по этой категории —
            ${slaHours} ${word}. Статус придёт уведомлением.`;
  }
  if (hm?.hasChairman) {
    return `Обращение увидит совет дома. Управляющей компании у вашего
            дома нет, поэтому статус менять некому — но запись останется
            с датой и никуда не денется.`;
  }
  return `За вашим домом пока никто не закреплён, но обращение сохранено
          с датой — его увидит тот, кто возьмётся за дом.`;
}

export function renderSuccess({ number, slaHours, houseManagement }) {
  const word = hoursWord(slaHours);
  return html`
    <div class="success-wrap">
      <div class="success-ic">
        <svg width="30" height="30" viewBox="0 0 28 28" fill="none"><path d="M6 14.5L11 19.5L22 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="success-h">Обращение принято</div>
      <div class="success-p">
        ${successText(houseManagement, slaHours, word)}
      </div>
      <div class="success-num">№ ${esc(number)}</div>
      <button class="btn-primary" style="max-width:260px" data-action="requests">
        К моим обращениям
      </button>
    </div>`;
}

/** Действия экранов заявок. Возвращает true, если действие обработано. */
export async function handleRequestAction(action, target, ctx) {
  switch (action) {
    case 'req-tab':
      window.__reqTab = target.dataset.tab;
      await ctx.show('requests');
      return true;

    case 'pick-cat':
    case 'pick-slot': {
      // Повторный тап по выбранному окну снимает выбор: иначе от
      // случайно нажатого времени было не избавиться
      const wasSelected = target.classList.contains('sel');
      target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
      if (!(action === 'pick-slot' && wasSelected)) target.classList.add('sel');
      return true;
    }

    case 'rate': {
      const stars = Number(target.dataset.stars);
      try {
        await api.rateRequest(target.dataset.id, stars);
        platform.haptic('medium');
        toast('Спасибо за оценку');
        await ctx.show('request', { id: target.dataset.id });
      } catch (error) {
        toast(error.message);
      }
      return true;
    }

    case 'call':
      toast(`Звоним: ${target.dataset.phone}`);
      return true;

    case 'send-comment': {
      const field = document.querySelector('#reqReply');
      const err = document.querySelector('#reqReplyErr');
      const text = field?.value.trim() ?? '';

      if (text.length < 2) {
        field?.classList.add('error');
        if (err) {
          err.textContent = 'Напишите ответ — пустое сообщение диспетчеру не поможет';
          err.classList.add('show');
        }
        field?.focus();
        return true;
      }
      field?.classList.remove('error');
      err?.classList.remove('show');

      await withLoading(target, async () => {
        try {
          const result = await api.commentRequest(target.dataset.id, text);
          platform.haptic('medium');
          toast(result.reopened ? 'Ответ отправлен — заявка снова в работе' : 'Ответ отправлен');
          await ctx.show('request', { id: target.dataset.id });
        } catch (error) {
          toast(error.message);
        }
      });
      return true;
    }

    case 'submit-request': {
      const desc = document.querySelector('#reqDesc');
      const err = document.querySelector('#reqDescErr');
      const text = desc?.value.trim() ?? '';

      if (text.length < 8) {
        desc?.classList.add('error');
        if (err) {
          err.textContent = 'Опишите проблему подробнее — хотя бы пару слов';
          err.classList.add('show');
        }
        desc?.focus();
        return true;
      }
      desc.classList.remove('error');
      err?.classList.remove('show');

      /**
       * Обращение принадлежит квартире, и без неё отправлять нечего.
       *
       * Состояние достижимо: у человека с отклонённой заявкой объекта
       * в профиле нет вовсе. Раньше здесь читалось `.propertyId`
       * у пустого значения, исключение перехватывалось общим catch,
       * и человек видел техническое сообщение вместо понятного отказа.
       */
      const propertyId = ctx.state.currentProperty?.propertyId;
      if (!propertyId) {
        toast('Сначала добавьте свой адрес — обращение подаётся по квартире');
        return true;
      }

      await withLoading(target, async () => {
        try {
          const category = document.querySelector('#catChips .chip.sel')?.dataset.v ?? 'Другое';
          const slot = document.querySelector('#slotChips .chip.sel')?.dataset;
          const result = await api.createRequest({
            propertyId,
            kind: target.dataset.kind,
            category,
            description: text,
            slotStart: slot?.start,
            slotEnd: slot?.end,
          });
          /**
           * Файлы уходят ПОСЛЕ создания обращения: у вложения должен быть
           * хозяин, а до ответа сервера идентификатора ещё нет.
           *
           * Неудачу отдельного файла не превращаем в неудачу обращения:
           * само обращение уже принято, и терять его из-за не влезшей
           * фотографии нельзя. Про такие файлы честно говорим.
           */
          const picked = document.querySelector('#reqFiles')?.files ?? [];
          const failed = [];
          for (const file of Array.from(picked).slice(0, 5)) {
            try {
              await api.attachFile(result.id, file);
            } catch (error) {
              failed.push(`${file.name}: ${error.message}`);
            }
          }

          platform.haptic('medium');
          platform.guardClosing(false);
          if (failed.length) toast(`Не удалось приложить — ${failed[0]}`);
          /**
           * `houseManagement` — с формы, не из ответа сервера: экран успеха
           * обязан сказать правду о том, кто на самом деле увидит заявку,
           * а не безусловно обещать диспетчера, которого может не быть.
           */
          await ctx.show('request-success', {
            ...result,
            houseManagement: ctx.state.currentProperty?.houseManagement,
          });
        } catch (error) {
          toast(error.message);
        }
      });
      return true;
    }

    /**
     * Открыть вложение.
     *
     * Прямой ссылкой в новую вкладку не обойтись: файл отдаётся только
     * с сессией, а внутри мессенджера открытая вкладка её не унесёт.
     * Поэтому качаем запросом и показываем как временный объект браузера.
     */
    case 'open-file': {
      await withLoading(target, async () => {
        try {
          const blob = await api.fetchFile(target.dataset.url);
          const url = URL.createObjectURL(blob);

          /**
           * Картинку показываем ПРЯМО ЗДЕСЬ, а не в новой вкладке.
           *
           * Внутри мессенджера новое окно часто не открывается вовсе:
           * вебвью гасит попапы, и человек видит, что «ничего не
           * произошло». Документ открыть больше негде, для него окно
           * остаётся, но у фотографий — а это почти все вложения —
           * превью надёжнее.
           */
          if (blob.type.startsWith('image/')) {
            const box = target.parentElement?.querySelector('.file-preview')
              ?? Object.assign(document.createElement('div'), { className: 'file-preview' });
            box.innerHTML = `<img src="${url}" alt="Вложение">`;
            target.insertAdjacentElement('afterend', box);
          } else {
            window.open(url, '_blank', 'noopener');
          }

          // Ссылка живёт пять минут: хватает посмотреть, и память не течёт
          setTimeout(() => URL.revokeObjectURL(url), 300000);
        } catch (error) {
          toast(error.message);
        }
      });
      return true;
    }

    case 'pick-files': {
      // Показываем, что именно выбрано: молчащая кнопка выглядит сломанной
      const list = document.querySelector('#reqFilesList');
      const picked = Array.from(target.files ?? []).slice(0, 5);
      if (!list) return true;

      list.innerHTML = picked.length
        ? picked.map((f) => `<div>${esc(f.name)} · ${esc(fileSize(f.size))}</div>`).join('')
        : `Фотография протечки или скан акта помогают диспетчеру больше, чем
           описание. Можно приложить до пяти файлов, каждый до 10 МБ.`;
      return true;
    }

    default:
      return false;
  }
}
