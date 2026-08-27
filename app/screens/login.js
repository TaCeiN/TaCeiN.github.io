import { api, ApiError } from '../api.js';
import { platform } from '../platform.js';
import { scanFromFile } from '../qr.js';
import { esc, html, toast, withLoading, errorState } from '../ui.js';
import { APP_NAME } from '../config.js';

/**
 * Вход по QR квитанции.
 *
 * Это первый экран и главный вау-момент демо: человек наводит камеру
 * на бумажную квитанцию и оказывается внутри — с именем, адресом
 * и лицевым счётом. Ни SMS, ни формы, ни пароля.
 */


/**
 * Единственный путь — фотография квитанции.
 *
 * ПОЧЕМУ ТОЛЬКО ОНА. Сканер мессенджера настроек не имеет вовсе — весь
 * его контракт это `openCodeReader(fileSelect)`, — и на живых устройствах
 * он не читает даже случайный QR с экрана. Вдобавок он отдаёт СТРОКУ,
 * то есть выбирает кодировку за нас и на windows-1251 ошибается.
 *
 * Своя камера через `getUserMedia` требует ОТДЕЛЬНОГО разрешения нашей
 * странице: пожилой человек, увидев внезапный системный запрос, жмёт
 * «Запретить» — и второй раз браузер уже не спросит.
 *
 * Фотография не требует ни того, ни другого: снимок делает системная
 * камера, а к нам приходят БАЙТЫ в полном разрешении, из которых мы
 * сами читаем кодировку по заголовку кода.
 */

export function renderLogin(state) {
  const { config, error, name, addingAddress, attachTo, attachLabel } = state;

  /**
   * В бою вход по квитанции работает только внутри MAX.
   *
   * Говорим это СРАЗУ, а не после сканирования. Иначе человек, открывший
   * сайт в браузере, наводит камеру на квитанцию, ждёт — и только тогда
   * получает отказ. Обещание, которое не выполняется, хуже отсутствующей
   * кнопки: выглядит как поломка приложения.
   */
  if (config && config.webLogin === false && !platform.inMax) {
    return html`
      <div class="page active" id="page-login">
        <div class="onb-hero">
          <div class="onb-logo">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M4 10.5L12 4L20 10.5V19.5C20 20 19.6 20.5 19 20.5H5C4.4 20.5 4 20 4 19.5V10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          </div>
          <div class="dt-title" style="margin-top:0">${esc(APP_NAME)}</div>
          <div class="success-p" style="margin:10px auto 0">
            Приложение открывается внутри мессенджера MAX. Там личность
            подтверждает сама платформа — поэтому вход по квитанции
            безопасен и не требует пароля.
          </div>
        </div>

        <div class="dt-card">
          <div class="meter-name">Как войти</div>
          <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
            Найдите в MAX бота
            ${config.botUsername ? html`<b>@${esc(config.botUsername)}</b>` : 'вашего дома'}
            и откройте мини-приложение. Дальше — отсканировать QR-код
            с квитанции ЖКУ, всё остальное приложение сделает само.
          </div>
          ${config.botUsername ? html`
            <a class="btn-primary" style="display:block;text-align:center;text-decoration:none"
               href="https://max.ru/${esc(config.botUsername)}?startapp"
               target="_blank" rel="noopener">Открыть в MAX</a>` : ''}
        </div>

        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Кабинет управляющей компании — по адресу <b>/dispatcher/</b>,
          он работает в браузере.
        </div>
      </div>`;
  }




  return html`
    <div class="page active" id="page-login">
      <div class="onb-hero">
        <div class="onb-logo">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M4 10.5L12 4L20 10.5V19.5C20 20 19.6 20.5 19 20.5H5C4.4 20.5 4 20 4 19.5V10.5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        </div>
        ${addingAddress
          // Заголовок уже стоит в шапке экрана — повторять его незачем
          ? ''
          : html`<div class="dt-title" style="margin-top:0">
              ${name ? `${esc(name)},<br>подтвердите адрес` : esc(APP_NAME)}
            </div>`}
        <div class="success-p" style="margin:10px auto 0" id="loginLead">
          ${attachTo
            /**
             * Три разных сценария за одним экраном, и каждый надо назвать.
             *
             * Здесь квартира уже известна: человек пришёл из неё самой.
             * Адрес спрашивать не будем — и это стоит сказать прямо,
             * потому что раньше форма адреса и была главной мукой.
             */
            ? `Квитанция добавится к квартире ${esc(attachLabel ?? '')}.
               Адрес спрашивать не будем — он уже известен.`
            : addingAddress
              ? `Это новый адрес — понадобится квитанция по нему. Свет, газ
                 и вывоз мусора для уже добавленной квартиры добавляются
                 внутри неё самой.`
              : `Отсканируйте QR-код с квитанции ЖКУ — приложение само определит
                 адрес, лицевой счёт и вашу управляющую компанию`}
        </div>
      </div>


      <div id="loginError">${error ? errorState(error) : ''}</div>

      <div id="scanActions">
        <!--
          Одна кнопка, и это фотография.

          Снимок делает системная камера: отдельного разрешения нашей
          странице не нужно, а к нам приходят БАЙТЫ в полном разрешении —
          кодировку по заголовку кода мы читаем сами. Живой сканер требовал
          бы разрешения на камеру, а сканер мессенджера не настраивается
          вовсе и на win-1251 ошибается.
        -->
        <label class="btn-primary" style="cursor:pointer;display:block;text-align:center">
          Сфотографировать квитанцию
          <input type="file" accept="image/*" id="qrFile" hidden>
        </label>
      </div>

      <div class="field-label" style="margin-top:26px">Где искать QR-код</div>
      <div class="dt-p" style="margin-top:0">
        Платёжный QR печатается на квитанции рядом с суммой к оплате.
        В нём уже есть всё нужное — вводить ничего не придётся.
      </div>

      ${config?.devTools ? `
        <div class="field-label" ${addingAddress ? 'style="margin-top:26px"' : ''}>
          Вставить строку QR вручную
        </div>
        <div class="dt-p" style="font-size:13px;color:var(--tx-2);margin-bottom:10px">
          Для проверки без камеры: строка напечатана в QR квитанции.
        </div>
        <textarea id="qrManual" placeholder="ST00011|Name=...|persAcc=..."></textarea>
        <button class="btn-primary secondary" data-action="manual">
          ${addingAddress ? 'Добавить по строке' : 'Войти по строке'}
        </button>
      ` : ''}
      </div>

      ${addingAddress ? `
        <!--
          Код приглашения на экране «Добавить недвижимость».

          Второй адрес человек чаще всего добавляет своей квитанцией,
          но бывает и наоборот: его позвал собственник другой квартиры —
          родители, дети, съём. Сканировать ему нечего.
        -->
        <div class="field-label" style="margin-top:26px">Код приглашения</div>
        <div class="dt-p" style="font-size:13px;color:var(--tx-2);margin-bottom:10px">
          Если собственник квартиры прислал вам код, квитанция не нужна.
        </div>
        <input type="text" id="inviteCode" placeholder="Например, K7MD9P"
               autocomplete="off" autocapitalize="characters"
               style="letter-spacing:.16em;text-transform:uppercase">
        <div class="field-error" id="inviteErr"></div>
        <button class="btn-primary secondary" data-action="redeem-invite">
          Войти по коду
        </button>
      ` : ''}
    </div>`;
}

/** Обработчики экрана входа. Возвращает функцию очистки. */
export function bindLogin(root, { onSuccess, rerender, refreshMe, attachTo }) {
  const showError = (error) => {
    const box = root.querySelector('#loginError');
    if (box) box.innerHTML = errorState(error);
  };

  /**
   * Отправка отсканированной строки.
   *
   * Квитанцию запоминаем: на занятом лицевом счёте сервер сначала спросит
   * имя, и повторно наводить камеру человеку не придётся.
   */
  let lastQr = null;
  /** Улица, выбранная в подсказке: код нужен серверу, а не текст поля */
  let chosenStreet = null;
  /** Заявка, которую сейчас дозаполняет человек */
  let pendingBinding = null;

  async function submit(qr, button, extra) {
    if (!qr) return;
    lastQr = qr;

    await withLoading(button, async () => {
      try {
        /**
         * Внутри объекта у квитанции другой смысл: не «впустите меня»,
         * а «этот счёт от этой квартиры». Поэтому и маршрут другой —
         * там уже есть сессия и выбранный объект, и адрес не спрашивается.
         */
        const result = attachTo
          ? await api.attachReceipt(attachTo, qr, extra)
          : await api.loginQr(qr, extra);

        /**
         * Квитанция заводит ЗАЯВКУ, а не открывает квартиру.
         *
         * Ответ один и тот же — занят лицевой счёт или свободен. Раньше
         * ответы различались, и по ним перебирались номера счетов
         * и фамилии собственников.
         */
        if (result?.status === 'pending') {
          platform.haptic('medium');
          if (result.claimComplete) await showPending(result);
          else showClaimForm(result);
          return;
        }

        platform.haptic('medium');
        onSuccess(result);
      } catch (error) {
        /**
         * В квитанции нет адреса — спрашиваем его один раз.
         *
         * По ГОСТ Р 56042-2014 адрес плательщика необязателен, и расчётные
         * центры его не печатают. Восстановить дом по одному лицевому счёту
         * невозможно: эта связка есть только в биллинге получателя платежа.
         */
        if (error instanceof ApiError && error.code === 'needs_address') {
          showAddressForm(error.body);
          return;
        }
        if (error instanceof ApiError && error.code === 'region_not_loaded') {
          showRegionMissing(error.body);
          return;
        }
        /** В бою вход по квитанции живёт только внутри MAX */
        if (error instanceof ApiError && error.code === 'web_login_disabled') {
          showWebLoginClosed(error.message);
          return;
        }

        /**
         * Кодировку испортил сканер — повторный скан ИМ ЖЕ даст тот же мусор.
         *
         * Единственный выход — путь, который отдаёт нам байты: фотография.
         * Поэтому здесь не сообщение об ошибке, а кнопка, которая сразу
         * открывает камеру системным выбором файла.
         */
        const reason = error instanceof ApiError ? error.body?.reason : null;
        if (reason === 'mangled' || reason === 'unparsable_address') {
          showPhotoFallback(error.message);
          return;
        }

        showError(error);
      }
    });
  }

  /**
   * Шаг «кто вы».
   *
   * Квитанция выписана на собственника, поэтому по ней собственник
   * и домочадец выглядят одинаково — угадать нельзя, надо спросить.
   * Раньше приложение молча решало само, и ломалось в обе стороны: то
   * владелец не мог добавить свежую квитанцию, то посторонний попадал
   * в чужой кабинет.
   */
  /**
   * Шаг «расскажите о себе».
   *
   * ЗАЧЕМ ОН ЕСТЬ. Доступ открывает председатель совета дома — человек,
   * который знает соседей в лицо. Но узнать он должен КОГО-ТО: в MAX
   * у половины аккаунтов нет фамилии, а у части вместо имени ник.
   * Поэтому ФИО и квартиру житель называет сам, а свободной строкой
   * может объяснить, кто он.
   *
   * Прежней формы «кто вы: жилец или собственник» здесь больше нет.
   * Она спрашивала человека о том, что проверить всё равно нельзя,
   * а ответ «это мой счёт» превращал экран в оракул для перебора ФИО:
   * угаданная фамилия сразу открывала чужой кабинет.
   */
  function showClaimForm(result) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    pendingBinding = result.bindingId;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Заявка принята</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${result.hasChairman
            ? `Доступ подтверждает председатель совета дома. Расскажите о себе,
               чтобы он понял, кто вы.`
            : `Доступ откроет председатель совета дома. Расскажите о себе,
               чтобы вас можно было найти в её данных.`}
        </div>

        <div class="field-label">Фамилия и имя</div>
        <input type="text" id="claimName" placeholder="Иванова Мария" autocomplete="name">

        <div class="field-label">Номер квартиры</div>
        <input type="text" id="claimFlat" placeholder="27" autocomplete="off">

        <div class="field-label">Что передать председателю</div>
        <textarea id="claimNote" placeholder="Например: живу с 2019 года, квартира на пятом этаже"></textarea>

        <div class="field-error" id="claimErr"></div>

        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Эти данные видит только тот, кто подтверждает доступ.
        </div>

        <button class="btn-primary" data-action="send-claim">Отправить заявку</button>
      </div>`;
    root.querySelector('#claimName')?.focus();
  }

  /** Вход по квитанции вне мессенджера в бою закрыт — объясняем честно. */
  function showWebLoginClosed(message) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Вход работает внутри MAX</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${esc(message)}
        </div>
      </div>`;
  }

  /**
   * Переход на фотографию квитанции.
   *
   * Нажатие пробрасывается на спрятанный `#qrFile` — тот же обработчик,
   * что и у кнопки «Загрузить фото», и та же проверка байтов. Отдельного
   * пути кода нет специально: два способа получить файл разъехались бы
   * при первой же правке.
   */
  function showPhotoFallback(message, title = 'Код прочитался неразборчиво') {
    const box = root.querySelector('#loginError');
    if (!box) return;

    /**
     * Кнопку в карточке рисуем, только если её ещё нет на экране.
     *
     * Внутри мессенджера «Сфотографировать квитанцию» и так стоит первой,
     * и вторая такая же прямо над ней читалась как сбой вёрстки: два
     * одинаковых синих прямоугольника подряд, и непонятно, чем они
     * отличаются. Здесь достаточно объяснить и показать пальцем.
     */
    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">${esc(title)}</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${esc(message)}
          Нажмите «Сфотографировать квитанцию» ниже — снимок отдаёт байты
          в полном разрешении, и код читается там, где сканер сдаётся.
        </div>
      </div>`;
  }

  /**
   * Выбор адреса из справочника.
   *
   * Улицу человек выбирает из подсказки, а номер дома и квартиры вводит
   * руками. Свободный ввод улицы был бы проще в коде и хуже в жизни: соседи
   * по одному дому написали бы адрес пятью способами, houseKey разошёлся,
   * и лента дома развалилась бы на пять «домов» по одному жильцу.
   */
  function showAddressForm(info) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">В квитанции нет адреса</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${esc(info?.payeeName ?? 'Получатель')} печатает квитанции без адреса —
          там только лицевой счёт ${esc(info?.persAcc ?? '')}. Укажите адрес
          один раз, дальше он подставится сам.
        </div>
        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Например: пр-кт Ленина, дом 85, корпус 3, квартира 27
        </div>

        <div class="field-label">Улица${info?.regionName ? `, ${esc(info.regionName)}` : ''}</div>
        <input type="text" id="addrStreet" placeholder="Начните вводить название"
               autocomplete="off" data-region="${esc(info?.regionCode ?? '')}">
        <div class="addr-hits" id="addrHits" hidden></div>
        <div class="field-error" id="addrErr"></div>

        <div class="addr-row">
          <div>
            <div class="field-label">Дом</div>
            <input type="text" id="addrHouse" placeholder="85 или 15А, 4Б/1" autocomplete="off">
          </div>
          <div>
            <div class="field-label">Корпус</div>
            <input type="text" id="addrBlock" placeholder="—" autocomplete="off">
          </div>
          <div>
            <div class="field-label">Строение</div>
            <input type="text" id="addrBuilding" placeholder="—" autocomplete="off">
          </div>
        </div>

        <div class="field-label">Квартира</div>
        <input type="text" id="addrFlat" placeholder="27" autocomplete="off">
        <div class="dt-p" style="font-size:13px;color:var(--tx-2);margin-top:8px">
          Частный дом — оставьте квартиру пустой. Букву и дробь пишите
          прямо в номере дома: «15А», «4Б/1».
        </div>

        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Управляющая компания увидит, что адрес указали вы, и подтвердит его.
        </div>

        <button class="btn-primary" data-action="submit-address">Продолжить</button>
      </div>`;

    bindStreetSearch();
    root.querySelector('#addrStreet')?.focus();
  }

  /** Регион не подключён: врать про «скоро» не надо, объясняем как есть. */
  function showRegionMissing(info) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    const available = info?.available ?? [];

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Регион пока не подключён</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${esc(info?.message ?? '')}
        </div>
        ${available.length ? html`
          <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
            Сейчас загружены: ${esc(available.map((r) => r.name).join(', '))}.
          </div>` : ''}
        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Попросите управляющую компанию подключиться к сервису — тогда адрес
          подставится автоматически, без ручного ввода.
        </div>
      </div>`;
  }

  /** Подсказка улиц. Запрос уходит с задержкой: иначе он летит на каждую букву. */
  function bindStreetSearch() {
    const field = root.querySelector('#addrStreet');
    const hits = root.querySelector('#addrHits');
    if (!field || !hits) return;

    let timer = null;

    field.addEventListener('input', () => {
      chosenStreet = null;
      clearTimeout(timer);
      const value = field.value.trim();

      if (value.length < 2) {
        hits.hidden = true;
        return;
      }

      timer = setTimeout(async () => {
        try {
          const data = await api.streets(field.dataset.region, value);
          hits.innerHTML = data.streets.length
            ? data.streets.map((s) => html`
                <button class="addr-hit" data-action="pick-street"
                        data-code="${esc(s.code)}" data-label="${esc(s.label)}">
                  ${esc(s.label)}
                </button>`).join('')
            : '<div class="addr-empty">Ничего не найдено</div>';
          hits.hidden = false;
        } catch (error) {
          hits.innerHTML = `<div class="addr-empty">${esc(error.message)}</div>`;
          hits.hidden = false;
        }
      }, 250);
    });
  }

  /** Экран ожидания. Проверка статуса — по кнопке, а не опросом сервера. */
  /**
   * Заявка отправлена — и это ЕДИНСТВЕННОЕ, что остаётся на экране.
   *
   * Кнопки сканирования прячем целиком. Пока они стояли рядом, человек
   * сканировал ту же квитанцию снова и снова, каждый раз получая тот же
   * ответ, — а заодно мог отсканировать чужую и завести вторую заявку,
   * не понимая, что делает. Ждать нечего: приложение его запомнило.
   *
   * Взамен показываем, что именно ушло председателю, и даём это отозвать.
   */
  async function showPending(result) {
    const box = root.querySelector('#loginError');
    if (!box) return;

    pendingBinding = result.bindingId ?? pendingBinding;

    /**
     * Подробности берём из своего профиля, а не из ответа на квитанцию:
     * там их нет, и передавать их через два экрана значило бы держать
     * копию данных, которые сервер и так отдаёт по одному запросу.
     */
    let claim = null;
    try {
      const me = await api.me();
      claim = (me.myPendingAccess ?? []).find((p) => p.bindingId === pendingBinding) ?? null;
    } catch {
      // Профиль не загрузился — карточку всё равно показываем, без подробностей
    }

    root.querySelector('#scanActions')?.setAttribute('hidden', '');
    root.querySelector('#loginLead')?.setAttribute('hidden', '');

    const decides = claim?.deciders?.chairman ?? result.hasChairman;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Заявка отправлена</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          ${decides
            ? `Председатель совета дома увидит её и подтвердит доступ.`
            : `У дома пока нет председателя. Попросите управляющую компанию
               его назначить — это делается один раз.`}
          Повторно сканировать квитанцию не нужно — приложение вас запомнило.
        </div>

        <div class="field-label">Что ушло председателю</div>
        <div class="list">
          ${claim?.addressRaw ? claimRow('Адрес', claim.addressRaw) : ''}
          ${claimRow('Фамилия и имя', claim?.claimName)}
          ${claimRow('Квартира', claim?.claimFlat)}
          ${claim?.claimNote ? claimRow('О себе', claim.claimNote) : ''}
        </div>

        <button class="btn-primary" data-action="enter-app">
          Перейти в приложение
        </button>
        <button class="btn-primary secondary" data-action="withdraw-claim">
          Отозвать заявку
        </button>
        <div class="dt-p" style="font-size:13px;color:var(--tx-2)">
          Начисления, счётчики, аналитика и обращение в управляющую компанию
          по этой квартире работают уже сейчас — ждать подтверждения для них
          не нужно.
        </div>
      </div>`;
  }

  /** Строка «что отправлено»: пустое поле не рисуем, оно ни о чём не говорит. */
  function claimRow(label, value) {
    if (!value) return '';
    return html`
      <div class="row">
        <div class="content">
          <div class="d">${esc(label)}</div>
          <div class="t" style="margin-top:2px">${esc(value)}</div>
        </div>
      </div>`;
  }

  /**
   * Отзыв — с предупреждением, потому что он необратим.
   *
   * Заявка удаляется из базы вместе с тем, что человек о себе рассказал.
   * Сказать это надо ДО нажатия, а не тостом после.
   */
  function showWithdrawConfirm() {
    const box = root.querySelector('#loginError');
    if (!box) return;

    box.innerHTML = html`
      <div class="dt-card" style="margin-top:0">
        <div class="meter-name">Отозвать заявку?</div>
        <div class="dt-p" style="font-size:14px;color:var(--tx-2);margin-top:6px">
          Заявка удалится вместе с тем, что вы о себе рассказали, —
          председатель её больше не увидит. Отсканировать квитанцию заново
          можно в любой момент.
        </div>
        <button class="btn-primary" data-action="withdraw-confirm">
          Да, отозвать
        </button>
        <button class="btn-primary secondary" data-action="withdraw-cancel">
          Оставить заявку
        </button>
      </div>`;
  }





  const onClick = async (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;


    if (action === 'manual') {
      const value = root.querySelector('#qrManual')?.value.trim();
      if (!value) return toast('Вставьте строку QR');
      await submit(value, target, { source: 'manual' });
    }
    if (action === 'pick-street') {
      chosenStreet = { code: target.dataset.code, label: target.dataset.label };
      const field = root.querySelector('#addrStreet');
      if (field) field.value = target.dataset.label;
      const hits = root.querySelector('#addrHits');
      if (hits) hits.hidden = true;
      root.querySelector('#addrHouse')?.focus();
      return;
    }

    if (action === 'submit-address') {
      const errorBox = root.querySelector('#addrErr');
      const house = root.querySelector('#addrHouse')?.value.trim() ?? '';
      const flat = root.querySelector('#addrFlat')?.value.trim() ?? '';

      const complain = (text) => {
        if (errorBox) {
          errorBox.textContent = text;
          errorBox.classList.add('show');
        }
      };

      if (!chosenStreet) return complain('Выберите улицу из подсказки');
      if (!house) return complain('Укажите номер дома');
      // Квартиру не требуем: у частного дома её нет
      errorBox?.classList.remove('show');

      await submit(lastQr, target, {
        address: {
          streetCode: chosenStreet.code,
          house,
          block: root.querySelector('#addrBlock')?.value.trim() || undefined,
          building: root.querySelector('#addrBuilding')?.value.trim() || undefined,
          flat: flat || undefined,
        },
      });
      return;
    }

    if (action === 'send-claim') {
      const name = root.querySelector('#claimName')?.value.trim() ?? '';
      const flat = root.querySelector('#claimFlat')?.value.trim() ?? '';
      const note = root.querySelector('#claimNote')?.value.trim() ?? '';
      const error = root.querySelector('#claimErr');

      const complain = (text) => {
        if (error) {
          error.textContent = text;
          error.classList.add('show');
        }
      };

      if (name.length < 3) return complain('Укажите фамилию и имя');
      if (!flat) return complain('Укажите номер квартиры');
      error?.classList.remove('show');

      await withLoading(target, async () => {
        try {
          await api.sendClaim(pendingBinding, { name, flat, note });
          platform.haptic('medium');
          /**
           * Состояние приложения обновляем ЗДЕСЬ, не уходя с экрана.
           *
           * Объект уже появился на сервере, и без этого профиль показывал
           * старый список до следующей перезагрузки: человек добавлял
           * вторую квартиру и не находил её.
           */
          await refreshMe?.();
          await showPending({ hasChairman: true });
        } catch (e) {
          complain(e.message);
        }
      });
      return;
    }

    if (action === 'enter-app') {
      /**
       * Выход в приложение прямо отсюда.
       *
       * Раньше после отправки заявки в интерфейс попадали только
       * перезапуском мини-аппа: экран заявки был тупиком, хотя уровень 0
       * по этой квартире уже открыт.
       */
      onSuccess({ status: 'pending' });
      return;
    }

    if (action === 'withdraw-claim') {
      showWithdrawConfirm();
      return;
    }

    if (action === 'withdraw-cancel') {
      await showPending({ hasChairman: true });
      return;
    }

    if (action === 'withdraw-confirm') {
      /**
       * Отзыв удаляет заявку на сервере, а не прячет её на экране.
       * После этого экран возвращается к сканированию: заявки больше нет,
       * и предлагать «проверить доступ» стало бы неправдой.
       */
      await withLoading(target, async () => {
        try {
          await api.withdrawClaim(pendingBinding);
          pendingBinding = null;
          platform.haptic('medium');
          await refreshMe?.();
          toast('Заявка отозвана');
          if (rerender) await rerender();
          else {
            root.querySelector('#scanActions')?.removeAttribute('hidden');
            root.querySelector('#loginLead')?.removeAttribute('hidden');
            const box = root.querySelector('#loginError');
            if (box) box.innerHTML = '';
          }
        } catch (e) {
          toast(e.message);
        }
      });
      return;
    }

  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const value = await scanFromFile(file);
      await submit(value, null, { source: 'photo' });
    } catch (error) {
      /**
       * «Не удалось загрузить» здесь неправда: снимок загрузился, кода
       * на нём не нашлось. Человеку нужен совет, что сделать со снимком,
       * а не сообщение о сбое.
       */
      showPhotoFallback(error.message, 'Код на фото не нашёлся');
    } finally {
      event.target.value = '';
    }
  };

  root.addEventListener('click', onClick);
  root.querySelector('#qrFile')?.addEventListener('change', onFile);

  return () => {
    root.removeEventListener('click', onClick);
  };
}

/**
 * Вход внутри MAX: если человек уже привязал счёт, квитанция не нужна.
 * Возвращает 'ok' | 'needs_receipt' | null.
 */
export async function tryMaxLogin() {
  if (!platform.inMax) return null;
  try {
    const result = await api.loginMax();
    return result?.status ?? null;
  } catch {
    return null;
  }
}
