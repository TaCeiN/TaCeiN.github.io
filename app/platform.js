/**
 * Адаптер платформы: одно приложение работает и внутри MAX, и как обычный сайт.
 *
 * Различия спрятаны здесь целиком. Экраны не должны знать, где они запущены —
 * иначе проверки «а мы в MAX?» расползутся по всему коду, и поддерживать
 * два режима станет невозможно.
 */

const bridge = () => (typeof window !== 'undefined' ? window.WebApp : undefined);

export const platform = {
  /** Внутри MAX доступен глобальный WebApp из max-web-app.js */
  get inMax() {
    return Boolean(bridge()?.initData);
  },

  get name() {
    return bridge()?.platform ?? 'web';
  },

  /**
   * iPhone. Нужен не ради красоты — на нём другой порядок способов сканирования.
   *
   * MAX убран из App Store 3 июня 2026, и на айфоне мессенджер живёт
   * веб-версией, добавленной на домашний экран. Мини-приложение там —
   * это iframe с чужого origin, а `getUserMedia` в таком iframe работает
   * только если родитель выставил `allow="camera"`, чего мы не контролируем.
   * Зато `<input type="file" capture>` — системный выбор файла, ему
   * разрешения фрейма не нужны, и он отдаёт нам БАЙТЫ.
   *
   * `WebApp.platform` здесь не помощник: в веб-клиенте он вернёт `web`
   * и на айфоне, и на десктопе.
   */
  get isIos() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent ?? '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS 13+ притворяется десктопным Safari, выдаёт его только тачскрин
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  },

  /**
   * Строка вида «ios 2026.14.3 iPhone 16» — для логов сервера, не для логики.
   *
   * Вне MAX возвращает null: скрипт платформы подключён на каждой странице
   * и объявляет `window.WebApp` даже в обычном браузере, поэтому проверять
   * надо не наличие моста, а подписанные initData.
   */
  get clientTag() {
    const b = bridge();
    if (!b?.initData) return null;
    return [b.platform, b.version, b.deviceName].filter(Boolean).join(' ') || null;
  },

  /**
   * Подписанные стартовые параметры.
   *
   * MAX кладёт их во фрагмент URL, а фрагмент браузер на сервер не отправляет —
   * поэтому клиент обязан передать строку явно заголовком. Это самая частая
   * ошибка первой интеграции.
   */
  get initData() {
    return bridge()?.initData ?? null;
  },

  /** Payload диплинка: max.ru/<bot>?startapp=<payload> */
  get startParam() {
    return bridge()?.initDataUnsafe?.start_param ?? null;
  },

  /**
   * Имя для приветствия до ответа сервера.
   * Только для отрисовки: доверять этим данным нельзя, подпись проверяет бэкенд.
   */
  get unsafeName() {
    const u = bridge()?.initDataUnsafe?.user;
    if (!u) return null;
    return [u.last_name, u.first_name].filter(Boolean).join(' ') || u.first_name;
  },

  /**
   * Нативная кнопка «Назад» в шапке MAX вместо нашей истории браузера.
   *
   * ОДИН обработчик на всё приложение. Раньше `show()` подписывал новый
   * при каждом переходе, а отписки не было вовсе: после пяти переходов
   * вглубь одно нажатие «Назад» вызывало возврат пять раз и выбрасывало
   * человека в корень. Теперь подписка ставится ровно один раз, а меняется
   * только то, куда она ведёт.
   */
  backButton: {
    _bound: false,
    _handler: null,

    show(handler) {
      const b = bridge()?.BackButton;
      if (!b) return false;

      this._handler = handler;
      if (!this._bound) {
        b.onClick(() => this._handler?.());
        this._bound = true;
      }
      b.show();
      return true;
    },

    hide() {
      this._handler = null;
      bridge()?.BackButton?.hide();
    },
  },

  /** Тактильный отклик. На десктопе и в вебе метода нет — молча пропускаем. */
  haptic(style = 'light') {
    try {
      bridge()?.HapticFeedback?.impactOccurred(style);
    } catch { /* не критично */ }
  },

  /** Не терять заполненную форму при случайном закрытии. */
  guardClosing(on) {
    try {
      const b = bridge();
      if (on) b?.enableClosingConfirmation?.();
      else b?.disableClosingConfirmation?.();
    } catch { /* не критично */ }
  },

  /** Поделиться кодом приглашения контакту в MAX. */
  async share(text) {
    const b = bridge();
    if (b?.shareContent) {
      await b.shareContent({ text });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ text });
      return true;
    }
    await navigator.clipboard?.writeText(text);
    return false;
  },

  /**
   * Телефон, подтверждённый аккаунтом MAX, — второй фактор.
   * Возвращает подписанные данные, проверяет их сервер.
   */
  async requestContact() {
    const b = bridge();
    if (!b?.requestContact) return null;
    try {
      const result = await b.requestContact();
      if (result?.error) return null;
      return result;
    } catch {
      return null;
    }
  },

  /**
   * Нативный сканер QR внутри MAX.
   *
   * ЧЕТЫРЕ ИСХОДА, А НЕ ДВА. Раньше метод возвращал `null` и на отсутствие
   * моста, и на исключение, и на отказ человека — экран входа показывал
   * «Сканирование отменено» во всех случаях, включая тот, где сканера
   * в клиенте просто нет. Человек читал, что он что-то отменил, и пробовал
   * снова с тем же результатом.
   *
   * По документации метод отдаёт `Promise<string>`; ветка с `value`
   * оставлена на случай, если клиент вернёт объект.
   */
  async scanNative(allowGallery = true) {
    const b = bridge();
    if (typeof b?.openCodeReader !== 'function') return { status: 'unsupported' };

    try {
      const result = await b.openCodeReader(allowGallery);
      const value = typeof result === 'string' ? result : (result?.value ?? null);
      if (!value) return { status: 'cancelled' };
      return { status: 'ok', value };
    } catch (error) {
      /**
       * Отказ человека часть клиентов отдаёт отклонённым промисом, часть —
       * пустым значением. Различить их нечем, поэтому исход `failed`
       * показывается мягко: не красной ошибкой, а подсказкой про фотографию.
       */
      return { status: 'failed', message: String(error?.message ?? error) };
    }
  },

  /** Реальная высота вьюпорта внутри вебвью. */
  async viewportHeight() {
    try {
      const size = await bridge()?.getViewportSize?.();
      return size?.height ? parseInt(size.height, 10) : null;
    } catch {
      return null;
    }
  },
};
