import { esc, html, money, toast } from '../ui.js';
import { platform } from '../platform.js';
import { activePropertyStore } from '../config.js';
import { propertyTitle, waitingText } from './home.js';

/**
 * Один объект недвижимости.
 *
 * Появился вместе с разведением двух действий. «Добавить недвижимость»
 * заводит новый адрес, «Добавить квитанцию» относит счёт к известной
 * квартире — и только потому, что квартира известна, у человека не надо
 * спрашивать адрес, которого в квитанции расчётного центра нет.
 */

const SERVICE_LABEL = {
  housing: 'ЖКУ',
  electricity: 'Электроэнергия',
  gas: 'Газ',
  water: 'Вода',
  heat: 'Отопление',
  waste: 'Вывоз мусора',
  overhaul: 'Капремонт',
  other: 'Прочее',
};

export function renderProperty(state, params) {
  const p = state.me.properties.find((x) => x.propertyId === params.id);
  if (!p) {
    return html`
      <div class="state">
        <div class="state-title">Объект не найден</div>
        <div class="state-text">Вернитесь к списку недвижимости</div>
      </div>`;
  }

  const isActive = state.currentProperty?.propertyId === p.propertyId;
  const accounts = p.accounts ?? [];

  return html`
    <div class="dt-card" style="margin-top:0">
      <div class="meter-name">${esc(propertyTitle(p))}</div>
      ${p.ukName ? html`
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          Дом обслуживает ${esc(p.ukName)}
        </div>` : ''}
      ${p.status === 'pending' ? html`
        <div class="dt-p" style="font-size:14px;color:var(--amber-deep);margin-top:6px">
          ${waitingText(p)}
        </div>` : ''}
      ${p.bill?.sumKopecks != null ? html`
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${esc(p.bill.periodLabel ?? '')} · ${esc(money(p.bill.sumKopecks))}
        </div>` : ''}
    </div>

    <div class="field-label">Лицевые счета</div>
    <div class="list">
      ${accounts.length === 0
        ? html`<div class="row"><div class="content">
            <div class="t">Пока ни одного</div>
            <div class="d">Добавьте квитанцию — счёт появится сам</div>
          </div></div>`
        : accounts.map((a) => html`
            <div class="row">
              <div class="content">
                <div class="t">${esc(SERVICE_LABEL[a.service] ?? 'Прочее')}</div>
                <div class="d">${esc(a.persAcc)} · ${esc(a.provider ?? '')}</div>
              </div>
            </div>`).join('')}
    </div>

    ${isActive
      ? ''
      : html`<button class="btn-primary secondary" data-action="make-active"
                     data-id="${esc(p.propertyId)}">Сделать активной</button>`}

    <button class="btn-primary" data-action="add-receipt"
            data-id="${esc(p.propertyId)}">Добавить квитанцию</button>

    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      Свет, газ и вывоз мусора приходят отдельными квитанциями — они
      добавятся к этой же квартире, адрес спрашивать не будем.
    </div>`;
}

export async function handlePropertyAction(action, target, ctx) {
  if (action === 'make-active') {
    const id = target.dataset.id;
    const found = ctx.state.me.properties.find((p) => p.propertyId === id);
    if (found) {
      ctx.state.currentProperty = found;
      activePropertyStore.set(ctx.state.me.user?.id, id);
      platform.haptic('light');
      toast('Теперь активна эта квартира');
    }
    await ctx.reset('home');
    return true;
  }

  if (action === 'add-receipt') {
    await ctx.show('add-receipt', { id: target.dataset.id });
    return true;
  }

  return false;
}
