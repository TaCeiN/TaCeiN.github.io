import { api } from '../api.js';
import { platform } from '../platform.js';
import {
  esc, html, formatDate, errorState, emptyState, toast, withLoading, plural,
} from '../ui.js';

/**
 * Жизнь дома: объявления УК, объявления соседей, опросы.
 *
 * ПРО ОПРОСЫ — важное. Это опросы, а не общее собрание собственников.
 * ОСС по ЖК РФ требует подсчёта по долям в праве собственности, кворума,
 * реестра собственников и протокола. Мы этого не делаем, поэтому оговорка
 * приходит с сервера полем legalNotice и выводится всегда: если оставить
 * её на совести вёрстки, она однажды потеряется, и приложение начнёт
 * обещать юридическую силу, которой у него нет.
 */

const CATEGORY_TONE = {
  outage: 'bad',
  meeting: 'new',
  news: '',
  market: 'ok',
};

/* ─────────────── лента ─────────────── */

export async function renderFeed(state, { category } = {}) {
  let posts;
  try {
    const scope = category === 'market' ? 'market' : 'house';
    posts = (await api.feed(scope)).posts
      /**
       * Вторая проверка поверх серверного scope.
       *
       * Доски обязаны быть раздельными: «Объявления дома» — это отключения
       * и собрания, а не «продам велосипед». Дублирующий фильтр стоит
       * ничего и держит экран честным, даже если до браузера доехал старый
       * или чужой ответ — с кэшем такое уже случалось.
       */
      .filter((p) => (scope === 'market' ? p.category === 'market' : p.category !== 'market'));
  } catch (error) {
    return errorState(error, category === 'market' ? 'market' : 'feed');
  }

  const isMarket = category === 'market';

  if (posts.length === 0) {
    return html`
      ${emptyState(
        isMarket ? 'Пока никто ничего не предлагает' : 'Объявлений нет',
        isMarket
          ? 'Здесь соседи по дому продают, отдают и предлагают услуги'
          : 'Управляющая компания пока ничего не публиковала',
      )}
      ${isMarket ? '<button class="btn-primary" data-action="new-post">Разместить объявление</button>' : ''}`;
  }

  return html`
    <div class="list">${posts.map(postRow).join('')}</div>
    ${isMarket ? '<button class="btn-primary" data-action="new-post">Разместить объявление</button>' : ''}`;
}

function postRow(p) {
  const tone = p.expired ? '' : CATEGORY_TONE[p.category] ?? '';
  return html`
    <button class="row tappable ${p.expired ? 'faded' : ''}" data-action="post" data-id="${esc(p.id)}">
      <span class="sq ${tone}">${categoryIcon(p.category)}</span>
      <div class="content">
        <div class="t">${esc(p.title)}</div>
        <div class="d">
          ${esc(p.categoryLabel)} · ${esc(p.author)} · ${esc(formatDate(p.publishedAt))}
          ${p.expired ? ' · завершено' : ''}
        </div>
      </div>
      <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>`;
}

function categoryIcon(category) {
  const paths = {
    outage: '<path d="M10 2L18 17H2L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 8V11.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="10" cy="14" r=".9" fill="currentColor"/>',
    meeting: '<circle cx="7" cy="7.5" r="2.6" stroke="currentColor" stroke-width="1.4"/><circle cx="14" cy="8.5" r="2.1" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 16C2.5 13.2 4.5 11.8 7 11.8C9.5 11.8 11.5 13.2 11.5 16M12.5 12.2C15 12.2 17.5 13.2 17.5 16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    market: '<path d="M3.5 6.8H16.5L15.6 16.5H4.4L3.5 6.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 6.8V5C7 3.9 8.3 3 10 3C11.7 3 13 3.9 13 5V6.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    news: '<rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M6 8H14M6 11.5H11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  };
  return `<svg viewBox="0 0 20 20" fill="none">${paths[category] ?? paths.news}</svg>`;
}

/* ─────────────── карточка объявления ─────────────── */

export async function renderPost(state, { id }) {
  let posts;
  try {
    posts = (await api.feed()).posts;
  } catch (error) {
    return errorState(error, 'feed');
  }

  const p = posts.find((x) => x.id === id);
  if (!p) return emptyState('Объявление не найдено', 'Возможно, его уже убрали');

  return html`
    <div class="dt-title">${esc(p.title)}</div>
    <div class="dt-meta">${esc(p.categoryLabel)} · ${esc(p.author)} · ${esc(formatDate(p.publishedAt))}</div>
    <div class="dt-p">${esc(p.body).replace(/\n/g, '<br>')}</div>

    ${p.contact ? html`
      <div class="dt-card">
        <div class="pay-label">Как связаться</div>
        <div class="dt-p" style="margin-top:6px">${esc(p.contact)}</div>
      </div>` : ''}

    ${p.type === 'resident' ? html`
      <div class="dt-p" style="color:var(--tx-2);font-size:13px">
        Объявление разместил сосед. Управляющая компания за него не отвечает
        и в сделке не участвует.
      </div>` : ''}

    ${p.type === 'chair' ? html`
      <div class="dt-p" style="color:var(--tx-2);font-size:13px">
        Опубликовал председатель совета дома — он выбран жильцами,
        а учётку подтвердила управляющая компания.
      </div>` : ''}`;
}

/* ─────────────── новое объявление ─────────────── */

export function renderPostForm() {
  return html`
    <div class="field-label" style="margin-top:2px">Заголовок</div>
    <input type="text" id="postTitle" placeholder="Например: Отдам детский велосипед">
    <div class="field-error" id="postTitleErr"></div>

    <div class="field-label">Описание</div>
    <textarea id="postBody" placeholder="Что предлагаете, в каком состоянии, на каких условиях"></textarea>
    <div class="field-error" id="postBodyErr"></div>

    <div class="field-label">Как с вами связаться</div>
    <input type="text" id="postContact" placeholder="Телефон, квартира или время, когда удобно">

    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      Объявление увидят только жители вашего дома. Указывайте лишь те
      контакты, которые готовы им показать.
    </div>

    <button class="btn-primary" data-action="submit-post">Разместить</button>`;
}

/* ─────────────── опросы ─────────────── */

export async function renderPolls() {
  let polls;
  try {
    polls = (await api.polls()).polls;
  } catch (error) {
    return errorState(error, 'polls');
  }

  if (polls.length === 0) {
    return emptyState(
      'Опросов нет',
      'Когда управляющая компания захочет узнать мнение жителей, опрос появится здесь',
    );
  }

  return html`
    <div class="list">
      ${polls.map((p) => html`
        <button class="row tappable" data-action="poll" data-id="${esc(p.id)}">
          <span class="sq ${p.closed ? '' : 'new'}">
            <svg viewBox="0 0 20 20" fill="none"><path d="M3.5 10L8 14.5L16.5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <div class="content">
            <div class="t">${esc(p.title)}</div>
            <div class="d">
              ${p.closed ? 'Завершён' : 'Идёт'} ·
              ${p.myOptionId ? 'вы проголосовали' : 'вы ещё не голосовали'}
            </div>
          </div>
          <span class="chev"><svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M5 3L9 7L5 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </button>`).join('')}
    </div>`;
}

export async function renderPoll(state, { id }) {
  let p;
  try {
    p = await api.poll(id);
  } catch (error) {
    return errorState(error, 'polls');
  }
  return pollBody(p);
}

function pollBody(p) {
  const voted = Boolean(p.myOptionId);

  return html`
    <div class="dt-title">${esc(p.title)}</div>
    ${p.description ? `<div class="dt-p">${esc(p.description)}</div>` : ''}
    <div class="dt-meta">
      ${p.closed ? 'Опрос завершён' : 'Опрос идёт'}
      ${p.closesAt && !p.closed ? ` · до ${esc(formatDate(p.closesAt))}` : ''}
      ${p.showResults ? ` · ${p.total} ${plural(p.total, 'голос', 'голоса', 'голосов')}` : ''}
    </div>

    <div id="pollOpts" style="margin-top:16px">
      ${p.options.map((o) => {
        const chosen = o.id === p.myOptionId;
        const hasResult = o.percent !== null;
        return html`
          <button class="vote-opt ${chosen ? 'chosen' : ''}"
                  ${p.closed ? 'disabled' : ''}
                  data-action="vote" data-poll="${esc(p.id)}" data-opt="${esc(o.id)}">
            <div class="vote-opt-top">
              <span>${esc(o.text)}</span>
              <span class="vote-check">
                ${chosen ? '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.2L6.5 11.2L12.5 4.8" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
              </span>
            </div>
            ${hasResult ? html`
              <div class="vote-bar-bg" style="display:block">
                <div class="vote-bar" style="width:${o.percent}%"></div>
              </div>
              <div class="vote-pct" style="display:block">${o.percent}% · ${o.votes} ${plural(o.votes, 'голос', 'голоса', 'голосов')}</div>` : ''}
          </button>`;
      }).join('')}
    </div>

    ${!p.showResults && !voted ? html`
      <div class="voted-note">
        Результаты откроются после вашего голоса — чтобы чужой выбор
        не влиял на ваш.
      </div>` : ''}

    <div class="dt-p" style="color:var(--tx-2);font-size:13px">
      ${esc(p.legalNotice)}
    </div>`;
}

/* ─────────────── действия ─────────────── */

export async function handleHouseAction(action, target, ctx) {
  switch (action) {
    case 'post':
      await ctx.show('post', { id: target.dataset.id });
      return true;

    case 'new-post':
      await ctx.show('new-post');
      return true;

    case 'poll':
      await ctx.show('poll', { id: target.dataset.id });
      return true;

    case 'vote': {
      if (target.disabled) return true;
      try {
        const updated = await api.vote(target.dataset.poll, target.dataset.opt);
        platform.haptic('medium');
        // Сервер возвращает опрос целиком — перерисовываем без второго запроса
        const host = document.querySelector('#screen');
        if (host) host.innerHTML = pollBody(updated);
      } catch (error) {
        toast(error.message);
      }
      return true;
    }

    case 'submit-post': {
      const title = document.querySelector('#postTitle');
      const body = document.querySelector('#postBody');
      const contact = document.querySelector('#postContact');

      if (!check(title, '#postTitleErr', 3, 'Придумайте короткий заголовок')) return true;
      if (!check(body, '#postBodyErr', 5, 'Опишите объявление подробнее')) return true;

      await withLoading(target, async () => {
        try {
          await api.createPost({
            propertyId: ctx.state.currentProperty?.propertyId,
            title: title.value.trim(),
            body: body.value.trim(),
            contact: contact?.value.trim(),
          });
          platform.haptic('medium');
          toast('Объявление размещено');
          await ctx.show('market');
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

function check(input, errorSelector, min, message) {
  const node = document.querySelector(errorSelector);
  const ok = (input?.value ?? '').trim().length >= min;

  input?.classList.toggle('error', !ok);
  if (node) {
    node.textContent = ok ? '' : message;
    node.classList.toggle('show', !ok);
  }
  if (!ok) input?.focus();
  return ok;
}
