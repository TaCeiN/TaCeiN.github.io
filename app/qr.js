import { platform } from './platform.js';
import { decodeImageData, decodeBlob } from './decoder.js';

/**
 * Получение строки платёжного QR с квитанции.
 *
 * Четыре пути, и порядок не случайный:
 *   1. Нативный сканер MAX — без запроса прав, но отдаёт готовую СТРОКУ,
 *      то есть кодировку выбирает за нас; ремонтирует её сервер
 *   2. Фотография квитанции — отдаёт байты и работает даже там, где камера
 *      во фрейме мессенджера закрыта политикой родителя (айфон)
 *   3. Камера через getUserMedia — браузерный режим, требует HTTPS
 *   4. Ручная вставка строки — для тестов без бумажной квитанции
 *
 * КЛЮЧЕВОЕ ПРО КОДИРОВКУ. Квитанции печатаются в Windows-1251 (заголовок
 * ST00011). Декодер отдаёт СЫРЫЕ БАЙТЫ — их и надо декодировать по признаку
 * из заголовка. Если взять готовую строку декодера (она собрана как UTF-8),
 * вся кириллица превратится в мусор: ФИО и адрес станут нечитаемыми.
 */

const ENCODINGS = { 1: 'windows-1251', 2: 'utf-8', 3: 'koi8-r' };

/** Декодирует байты QR по признаку кодировки из служебного блока. */
export function decodeQrBytes(bytes) {
  if (!bytes || bytes.length < 8) return null;

  const header = String.fromCharCode(...bytes.slice(0, 8));
  // Не платёжный QR — отдаём как есть, ошибку покажет сервер
  if (!header.startsWith('ST')) return new TextDecoder('utf-8').decode(new Uint8Array(bytes));

  const label = ENCODINGS[header[6]];
  if (!label) return new TextDecoder('utf-8').decode(new Uint8Array(bytes));

  try {
    return new TextDecoder(label).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  }
}

/** Есть ли вообще смысл показывать кнопку камеры. */
export function cameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

/**
 * Сканирование камерой в браузере.
 *
 * Возвращает объект с методами stop() и torch(on) — поток нужно закрывать
 * вручную, иначе камера останется включённой после ухода с экрана.
 */
export async function scanWithCamera({ video, canvas, onResult, onError }) {
  if (!cameraAvailable()) {
    onError?.(new Error(
      window.isSecureContext
        ? 'Камера недоступна на этом устройстве'
        : 'Камера работает только по HTTPS. Сфотографируйте квитанцию.',
    ));
    return { stop() {}, torch: () => false };
  }

  let stream;
  try {
    /**
     * Разрешение просим явно.
     *
     * По умолчанию браузер даёт 640×480 — на таком кадре QR квитанции
     * занимает считаные пиксели на модуль и не читается вовсе. Просим 1920
     * и непрерывный автофокус: бумага лежит близко, и без него камера
     * ловит фокус на фоне.
     */
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [{ focusMode: 'continuous' }],
      },
      audio: false,
    });
  } catch (error) {
    onError?.(new Error(
      error?.name === 'NotAllowedError'
        ? 'Доступ к камере не разрешён. Сфотографируйте квитанцию — так тоже работает.'
        : 'Не удалось включить камеру. Сфотографируйте квитанцию — так тоже работает.',
    ));
    return { stop() {}, torch: () => false };
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => {});

  let stopped = false;
  let busy = false;
  let pass = 0;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  /**
   * Два прохода по очереди.
   *
   * Чётный — центральный квадрат в НАТИВНОМ разрешении: человек наводит
   * рамку на код, и там он крупный. Нечётный — весь кадр, ужатый до 1000 px:
   * страховка, когда код оказался с краю. Разбирать весь кадр в полном
   * разрешении на каждом шаге слишком дорого для слабого телефона.
   */
  function frameToImageData() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;

    if (pass % 2 === 0) {
      const side = Math.round(Math.min(w, h) * 0.7);
      canvas.width = side;
      canvas.height = side;
      context.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
    } else {
      const scale = Math.min(1, 1000 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  async function tick() {
    if (stopped) return;

    /**
     * Пока декодер занят, новые кадры не берём.
     *
     * ZXing с tryHarder на кадре 1080p думает десятки миллисекунд, а кадры
     * приходят каждые 16. Без этого флага очередь растёт быстрее, чем
     * разбирается, и картинка в видоискателе замерзает.
     */
    if (!busy && video.readyState === video.HAVE_ENOUGH_DATA) {
      busy = true;
      const image = frameToImageData();
      pass += 1;

      if (image) {
        const bytes = await decodeImageData(image).catch(() => null);
        if (bytes && !stopped) {
          const text = decodeQrBytes(bytes);
          if (text) {
            stop();
            onResult(text);
            return;
          }
        }
      }
      busy = false;
    }

    schedule();
  }

  /**
   * requestVideoFrameCallback вместо requestAnimationFrame.
   *
   * rAF срабатывает по частоте экрана, а не камеры: один и тот же кадр
   * разбирался по два-три раза подряд впустую. Метод есть не везде —
   * там остаётся rAF.
   */
  function schedule() {
    if (stopped) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => { void tick(); });
    } else {
      requestAnimationFrame(() => { void tick(); });
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }

  /** Фонарик. Есть на Android, на iOS браузером не управляется — молча выходим. */
  function torch(on) {
    const track = stream.getVideoTracks()[0];
    if (!track?.getCapabilities?.().torch) return false;
    track.applyConstraints({ advanced: [{ torch: Boolean(on) }] }).catch(() => {});
    return true;
  }

  schedule();
  return { stop, torch };
}

/** Распознавание из файла: фото квитанции из галереи или с камеры. */
export async function scanFromFile(file) {
  const bytes = await decodeBlob(file);
  if (!bytes) {
    throw new Error(
      'QR-код на фото не найден. Снимите ближе и ровнее, чтобы код попал в кадр целиком.',
    );
  }
  return decodeQrBytes(bytes);
}

/**
 * Нативный сканер MAX, если приложение открыто внутри мессенджера.
 * Возвращает разбор исхода — см. platform.scanNative.
 */
export async function scanNative() {
  return platform.scanNative(true);
}
