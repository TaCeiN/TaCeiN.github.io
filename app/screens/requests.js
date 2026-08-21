import { api } from '../api.js';
import { platform } from '../platform.js';
import {
  esc, html, formatDate, loadingState, errorState, emptyState, toast, withLoading,
} from '../ui.js';

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

export async function renderRequests() {
  let data;
  try {
    data = await api.requests();
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
  return html`
    <button class="wrow tappable" data-action="request" data-id="${esc(r.id)}">
      <span class="sq ${tone}">${statusIcon(r.status)}</span>
      <div class="content">
        <div class="t">${esc(r.title)}</div>
        <div class="d">№ ${esc(r.number)} · ${esc(r.category)}</div>
      </div>
      <span class="pill ${tone}">${esc(r.statusLabel)}</span>
    </button>`;
}

function statusIcon(status) {
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

  const closed = r.status === 'done' || r.status === 'rejected';

  return html`
    <div class="dt-title">${esc(r.title)}</div>
    <div class="dt-meta">№ ${esc(r.number)} · ${esc(r.category)}</div>

    <div class="dt-card">
      ${track(r.status)}
      <div class="track-labels">
        <span>принято</span><span>в работе</span><span>выполнено</span>
      </div>
      ${!closed && r.slaLabel ? `
        <div class="sla ${SLA_TONE[r.sla] ?? ''}">
          ${r.sla === 'overdue' ? 'Срок вышел' : 'Срок реакции'} · ${esc(r.slaLabel)}
        </div>` : ''}
    </div>

    ${r.assigneeName ? `
      <div class="field-label">Мастер</div>
      <div class="list"><div class="row">
        <span class="sq new"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="7.5" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 17C4.5 13.8 7 12.4 10 12.4C13 12.4 15.5 13.8 15.5 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>
        <div class="content"><div class="t">${esc(r.assigneeName)}</div><div class="d">назначен диспетчером</div></div>
      </div></div>` : ''}

    ${r.rejectReason ? `
      <div class="field-label">Почему отклонено</div>
      <div class="dt-card"><div class="dt-p" style="margin-top:0">${esc(r.rejectReason)}</div></div>` : ''}

    <div class="field-label">Описание</div>
    <div class="dt-card" style="margin-top:0">
      <div class="dt-p" style="margin-top:0">${esc(r.description)}</div>
    </div>

    <div class="field-label">История</div>
    <div class="dt-card" style="margin-top:0">
      <div class="timeline">
        ${r.events.map((e) => html`
          <div class="tl-row">
            <div class="tl-dot-col"><div class="tl-dot"></div><div class="tl-line"></div></div>
            <div class="tl-body">
              <div class="tl-t">${esc(e.text)}</div>
              <div class="tl-time">${esc(formatDate(e.at))}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>

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

export function renderComplaintForm(state, kind = 'complaint') {
  const property = state.currentProperty;
  const isMaster = kind === 'master';

  return html`
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

    ${isMaster ? `
      <div class="field-label">Когда удобно принять мастера</div>
      <div class="chips" id="slotChips"></div>
    ` : ''}

    <div class="dt-p">
      Срок реакции зависит от категории: аварии — 2 часа, сантехника
      и электрика — сутки, остальное — трое суток.
    </div>

    <button class="btn-primary" id="reqSubmit" data-action="submit-request" data-kind="${esc(kind)}">
      ${isMaster ? 'Вызвать мастера' : 'Отправить обращение'}
    </button>`;
}

export function renderSuccess({ number, slaHours }) {
  const word = slaHours === 2 ? 'часа' : slaHours < 5 ? 'часа' : 'часов';
  return html`
    <div class="success-wrap">
      <div class="success-ic">
        <svg width="30" height="30" viewBox="0 0 28 28" fill="none"><path d="M6 14.5L11 19.5L22 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="success-h">Обращение принято</div>
      <div class="success-p">
        Диспетчер увидит заявку сразу. Срок реакции по этой категории —
        ${slaHours} ${word}. Статус придёт уведомлением.
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

    case 'pick-cat': {
      target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
      target.classList.add('sel');
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

      await withLoading(target, async () => {
        try {
          const category = document.querySelector('#catChips .chip.sel')?.dataset.v ?? 'Другое';
          const result = await api.createRequest({
            propertyId: ctx.state.currentProperty.propertyId,
            kind: target.dataset.kind,
            category,
            description: text,
          });
          platform.haptic('medium');
          platform.guardClosing(false);
          await ctx.show('request-success', result);
        } catch (error) {
          toast(error.message);
        }
      });
      return true;
    }

    default:
      return false;
  }
}
