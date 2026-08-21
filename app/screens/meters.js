import { api } from '../api.js';
import { platform } from '../platform.js';
import {
  esc, html, errorState, emptyState, toast, withLoading, plural,
} from '../ui.js';

/**
 * Счётчики и аналитика потребления.
 *
 * Главное в этом экране — не форма, а предупреждения. Опечатка на порядок
 * (2214 вместо 221.4) стоит жителю десятки тысяч рублей, просроченная
 * поверка переводит начисление на норматив, а показания вне окна приёма
 * учтут только в следующем месяце. Всё это человек узнаёт из квитанции,
 * когда что-то менять уже поздно, — поэтому говорим заранее.
 */

/* ─────────────── передача показаний ─────────────── */

export async function renderMeters(state) {
  const property = state.currentProperty;
  if (!property) return emptyState('Адрес не привязан', 'Отсканируйте квитанцию');

  let data;
  try {
    data = await api.meters(property.propertyId);
  } catch (error) {
    return errorState(error, 'meters');
  }

  if (data.meters.length === 0) {
    return emptyState(
      'Счётчиков нет',
      'По этому лицевому счёту приборы учёта не заведены. Начисление идёт по нормативу.',
    );
  }

  const win = data.window;

  return html`
    <div class="win-note ${win.open ? 'open' : ''}">
      <span class="win-dot"></span>
      <div>
        <div class="win-t">${esc(win.message)}</div>
        ${win.open && win.daysLeft !== null ? html`
          <div class="win-d">
            Осталось ${win.daysLeft} ${plural(win.daysLeft, 'день', 'дня', 'дней')}
          </div>` : ''}
      </div>
    </div>

    ${data.meters.map((m) => meterCard(m, data.period)).join('')}

    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      Показания принимаются с ${win.from} по ${win.to} число.
      Без них начисляют по нормативу — это почти всегда дороже фактического расхода.
    </div>
  `;
}

function meterCard(m, period) {
  const submitted = m.submittedThisPeriod;

  return html`
    <div class="meter-card" data-meter="${esc(m.id)}">
      <div class="meter-top">
        <div>
          <div class="meter-name">${esc(m.label)}</div>
          ${m.serial ? `<div class="meter-serial">№ ${esc(m.serial)}</div>` : ''}
        </div>
        <div class="meter-prev">
          ${m.previous !== null
            ? `было ${fmt(m.previous)} ${esc(m.unit)}`
            : 'первая передача'}
        </div>
      </div>

      ${m.verificationOverdue ? html`
        <div class="warn-line bad">
          Поверка просрочена. До неё начисление идёт по нормативу.
        </div>` : ''}

      ${submitted ? html`
        <div class="meter-done">
          <svg viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5L8.2 14.2L15.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Показания за ${esc(periodName(period))} переданы
        </div>` : html`
        <div class="meter-input-row">
          <input type="text" inputmode="decimal" id="mv-${esc(m.id)}"
                 placeholder="${m.previous !== null ? fmt(m.previous) : '0'}"
                 aria-label="${esc(m.label)}">
          <span class="meter-unit">${esc(m.unit)}</span>
          <button class="meter-send" data-action="send-reading" data-id="${esc(m.id)}">
            Передать
          </button>
        </div>
        ${m.averageConsumption > 0 ? html`
          <div class="meter-hint">
            Обычный расход — около ${fmt(m.averageConsumption)} ${esc(m.unit)} в месяц
          </div>` : ''}
        <div class="warn-line" id="mw-${esc(m.id)}" style="display:none"></div>
      `}
    </div>`;
}

/* ─────────────── аналитика ─────────────── */

export async function renderAnalytics(state) {
  const property = state.currentProperty;
  if (!property) return emptyState('Адрес не привязан', 'Отсканируйте квитанцию');

  let data;
  try {
    data = await api.analytics(property.propertyId);
  } catch (error) {
    return errorState(error, 'analytics');
  }

  const pay = data.payments;

  if (pay.points.length === 0) {
    return emptyState(
      'Данных пока нет',
      data.hint ?? 'Отсканируйте квитанции за прошлые месяцы, чтобы увидеть динамику',
    );
  }

  return html`
    <div class="dt-card">
      <div class="pay-label">Начисления по месяцам</div>
      ${barChart(pay.points.map((p) => ({
        label: p.label,
        value: p.value,
        text: Math.round(p.value / 100),
      })))}
      ${deltaLine(pay.change, 'Начисление')}
    </div>

    ${data.forecast ? html`
      <div class="dt-card">
        <div class="pay-label">Прогноз на следующий месяц</div>
        <div class="pay-amt" style="font-size:26px">${esc(data.forecast.formatted)}</div>
        <div class="meter-hint" style="margin-top:6px">
          Оценка: ${esc(data.forecast.basis)}
        </div>
      </div>` : ''}

    ${data.meters.map((s) => html`
      <div class="dt-card">
        <div class="pay-label">${esc(s.label)}, ${esc(s.unit)}</div>
        ${barChart(s.points.map((p) => ({
          label: p.label, value: p.value, text: fmt(p.value),
        })))}
        ${deltaLine(s.change, 'Расход')}
      </div>`).join('')}

    ${data.hint ? `<div class="dt-p" style="color:var(--tx-2);font-size:13px">${esc(data.hint)}</div>` : ''}

    ${data.tips.length ? html`
      <div class="s-label"><h2>На что обратить внимание</h2></div>
      <div class="list">
        ${data.tips.map((t) => html`
          <div class="row">
            <div class="content">
              <div class="t">${esc(t.title)}</div>
              <div class="d">${esc(t.body)}</div>
            </div>
          </div>`).join('')}
      </div>` : ''}
  `;
}

/**
 * Столбчатый график без библиотек.
 *
 * Высота считается от максимума ряда, а не от нуля оси: при близких
 * значениях столбики иначе выглядят одинаковыми, и разницу между
 * месяцами не видно вовсе.
 */
function barChart(points) {
  const shown = points.slice(-6);
  const max = Math.max(...shown.map((p) => p.value), 1);

  return html`
    <div class="chart" style="margin-top:14px">
      ${shown.map((p, i) => {
        const height = Math.max(6, Math.round((p.value / max) * 100));
        return html`
          <div class="col ${i === shown.length - 1 ? 'last' : ''}">
            <span class="val">${esc(p.text)}</span>
            <div class="bar" style="height:${height}%"></div>
            <span class="mon">${esc(p.label)}</span>
          </div>`;
      }).join('')}
    </div>`;
}

function deltaLine(change, subject) {
  if (change === null || change === undefined) {
    return '<div class="delta" style="color:var(--tx-2)">Нужен ещё месяц данных для сравнения</div>';
  }
  if (change === 0) return `<div class="delta" style="color:var(--tx-2)">${esc(subject)} как в прошлом месяце</div>`;

  const up = change > 0;
  return `<div class="delta ${up ? 'up' : 'down'}">
    ${esc(subject)} ${up ? 'вырос' : 'снизился'} на ${Math.abs(change)}% к прошлому месяцу
  </div>`;
}

/* ─────────────── действия ─────────────── */

export async function handleMeterAction(action, target, ctx) {
  if (action !== 'send-reading' && action !== 'confirm-reading') return false;

  const id = target.dataset.id;
  const input = document.querySelector(`#mv-${cssEscape(id)}`);
  const warn = document.querySelector(`#mw-${cssEscape(id)}`);
  const value = (input?.value ?? '').trim();

  if (!value) {
    input?.focus();
    toast('Введите показания');
    return true;
  }

  await withLoading(target, async () => {
    try {
      const result = await api.submitReading(id, value, action === 'confirm-reading');
      platform.haptic('medium');

      const extra = result.warnings?.length
        ? ` ${result.warnings[0].message}`
        : '';
      toast(`Принято. Расход ${fmt(result.consumption)}.${extra}`.trim());
      await ctx.refresh();
    } catch (error) {
      /**
       * Подозрительный скачок — не отказ, а вопрос. Показываем его рядом
       * с полем вместе с кнопкой подтверждения: тост тут не годится, он
       * исчезнет раньше, чем человек сверится с табло счётчика.
       */
      if (error.body?.confirmable && warn) {
        warn.className = 'warn-line bad';
        warn.style.display = 'block';
        warn.innerHTML = html`
          ${esc(error.message)}
          <button class="warn-confirm" data-action="confirm-reading" data-id="${esc(id)}">
            Всё верно, передать
          </button>`;
        return;
      }
      toast(error.message);
    }
  });
  return true;
}

/* ─────────────── мелочи ─────────────── */

/** Идентификаторы у нас безопасные, но селектор всё равно не склеиваем вслепую. */
function cssEscape(value) {
  return CSS?.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '');
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function periodName(period) {
  const [, month] = String(period).split('-');
  return MONTHS[Number(month) - 1] ?? period;
}
