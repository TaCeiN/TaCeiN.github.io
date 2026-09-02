import { api } from '../api.js';
import { platform } from '../platform.js';
import {
  esc, html, errorState, emptyState, toast, withLoading, plural,
} from '../ui.js';

/**
 * Счётчики и аналитика потребления.
 *
 * ЭТО ДНЕВНИК, А НЕ ПЕРЕДАЧА ПОКАЗАНИЙ. Показания не уходят никуда:
 * ни в управляющую компанию, ни в ресурсную организацию, ни в ГИС ЖКХ —
 * доступа туда у приложения нет и не предвидится. Экран, который называл
 * это «приёмом показаний», врал самым дорогим для жителя способом:
 * человек считал, что передал, второй раз никуда не передавал и получал
 * начисление по нормативу.
 *
 * Польза дневника настоящая и остаётся: опечатка на порядок (2214 вместо
 * 221.4) стоит десятки тысяч рублей, просроченная поверка переводит
 * начисление на норматив, а выросший расход выдаёт подтекающий бачок.
 * Поэтому предупреждения здесь по-прежнему главнее формы.
 */

/* ─────────────── запись показаний ─────────────── */

/**
 * Что этот раздел делает на самом деле.
 *
 * Стоит первой и постоянно, а не прячется в подсказку: это ответ
 * на единственный вопрос, из-за которого экран мог стоить человеку денег.
 */
function journalNote() {
  return html`
    <div class="dt-card" style="margin-top:0;margin-bottom:14px">
      <div class="meter-name">Это ваш дневник показаний</div>
      <div class="dt-p" style="font-size:13px;color:var(--tx-2);margin-top:6px">
        В управляющую компанию мы показания не передаём — передайте их сами,
        как привыкли. Здесь они останутся с датами: чтобы не заводить тетрадь,
        видеть расход и не ошибиться при вводе.
      </div>
    </div>`;
}

export async function renderMeters(state) {
  const property = state.currentProperty;
  if (!property) return emptyState('Адрес не привязан', 'Отсканируйте квитанцию');

  let data;
  try {
    data = await api.meters(property.propertyId);
  } catch (error) {
    return errorState(error, 'meters');
  }

  const win = data.window;

  if (data.meters.length === 0) {
    return html`
      ${journalNote()}
      <div class="state">
        <div class="state-title">Счётчиков пока нет</div>
        <div class="state-text">
          Заведите приборы учёта, которые стоят у вас в квартире, — после этого
          можно записывать показания и видеть расход по месяцам.
        </div>
      </div>
      ${addMeterForm(data.kinds)}`;
  }

  /**
   * Полоса напоминает о ЧУЖОМ сроке.
   *
   * Зелёной точки «идёт приём» и обратного отсчёта здесь больше нет:
   * своего приёма показаний у приложения не существует, а считать чужой
   * срок, которого мы не знаем, — то же обещание, только мельче.
   */
  return html`
    ${journalNote()}

    <div class="win-note">
      <div class="win-t">
        Большинство УК принимают показания с ${win.from} по ${win.to} число
      </div>
      <div class="win-d">Точную дату смотрите в своей квитанции</div>
    </div>

    ${data.meters.map((m) => meterCard(m, data.period)).join('')}

    ${addMeterForm(data.kinds, data.meters)}
  `;
}

/**
 * Форма «завести счётчик».
 *
 * Вопрос ровно один: что прибор считает. Заводской номер и дату поверки
 * дневнику знать незачем — показания никуда не уходят, сверять их
 * по номеру некому, — а три поля вместо одного это три повода бросить
 * форму на середине.
 */
function addMeterForm(kinds = [], existing = []) {
  const taken = new Set(existing.map((m) => m.kind));
  const free = kinds.filter((k) => !taken.has(k.kind));
  if (free.length === 0) return '';

  return html`
    <div class="dt-card">
      <div class="meter-name">Добавить счётчик</div>

      <div class="field-label">Что считает</div>
      <div class="chips" id="meterKinds">
        ${free.map((k, i) => html`
          <span class="chip ${i === 0 ? 'sel' : ''}" data-action="pick-meter-kind"
                data-v="${esc(k.kind)}">${esc(k.label)}</span>`).join('')}
      </div>

      <div class="field-error" id="meterAddErr"></div>
      <button class="btn-primary" data-action="add-meter">Добавить</button>
    </div>`;
}

function meterCard(m, period) {
  const submitted = m.submittedThisPeriod;

  return html`
    <div class="meter-card" data-meter="${esc(m.id)}">
      <div class="meter-top">
        <div class="meter-name">${esc(m.label)}</div>
        <div class="meter-prev">
          ${m.previous !== null
            ? `было ${fmt(m.previous)} ${esc(m.unit)}`
            : 'первая запись'}
        </div>
      </div>

      ${submitted ? html`
        <div class="meter-done">
          <svg viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5L8.2 14.2L15.5 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Записаны за ${esc(periodName(period))}
        </div>` : html`
        <div class="meter-input-row">
          <input type="text" inputmode="decimal" id="mv-${esc(m.id)}"
                 placeholder="${m.previous !== null ? fmt(m.previous) : '0'}"
                 aria-label="${esc(m.label)}">
          <span class="meter-unit">${esc(m.unit)}</span>
          <button class="meter-send" data-action="send-reading" data-id="${esc(m.id)}">
            Записать
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
      ${latestBreakdown(pay.latest)}
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
 * Из чего сложилась сумма последнего месяца.
 *
 * Столбик графика — сумма всех квитанций месяца, а квитанций у квартиры
 * столько, сколько лицевых счетов: ЖКУ и свет приходят отдельно. Без
 * этой строки человек видит одну цифру и не знает, из чего она.
 *
 * При одном счёте строка не нужна: она повторила бы столбик.
 */
function latestBreakdown(latest) {
  if (!latest || latest.accountsTotal <= 1) return '';

  /**
   * Две квитанции с одинаковой подписью — штатный случай: услуга в счёте
   * называется одинаково, а платят разным организациям. Тогда различает
   * номер счёта, иначе строка читается как «ЖКУ дважды».
   */
  const twice = (label) => latest.parts.filter((p) => p.label === label).length > 1;
  const parts = latest.parts
    .map((p) => (twice(p.label)
      ? `${esc(p.label)} по счёту ${esc(p.persAcc)} ${esc(p.formatted)}`
      : `${esc(p.label)} ${esc(p.formatted)}`))
    .join(' · ');

  /**
   * Месяц, где отсканирована не каждая квитанция, без оговорки выглядит
   * как «стало дешевле» — это та же ложь, что и два столбца за один
   * месяц, только с другой стороны.
   */
  const missing = latest.partial
    ? html`<div class="meter-hint" style="margin-top:6px">
        За ${esc(periodName(latest.period))} ${esc(String(latest.parts.length))}
        ${esc(plural(latest.parts.length, 'квитанция', 'квитанции', 'квитанций'))}
        из ${esc(String(latest.accountsTotal))} — сумма неполная.
        Отсканируйте остальные, чтобы сравнение было честным.
      </div>`
    : '';

  const month = periodName(latest.period);

  return html`
    <div class="meter-hint" style="margin-top:10px">
      ${esc(month.charAt(0).toUpperCase() + month.slice(1))}: ${parts}
    </div>
    ${missing}`;
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
  if (action === 'pick-meter-kind') {
    target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
    target.classList.add('sel');
    return true;
  }

  if (action === 'add-meter') {
    const kind = document.querySelector('#meterKinds .chip.sel')?.dataset.v;
    const error = document.querySelector('#meterAddErr');

    if (!kind) {
      if (error) {
        error.textContent = 'Выберите, что считает прибор';
        error.classList.add('show');
      }
      return true;
    }

    await withLoading(target, async () => {
      try {
        await api.addMeter(ctx.state.currentProperty.propertyId, {
          kind,
        });
        toast('Счётчик добавлен');
        await ctx.refresh();
      } catch (e) {
        if (error) {
          error.textContent = e.message;
          error.classList.add('show');
        }
      }
    });
    return true;
  }

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
      toast(`Записано. Расход ${fmt(result.consumption)}.${extra}`.trim());
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
            Всё верно, записать
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
