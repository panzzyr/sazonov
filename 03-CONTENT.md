# 03 — Контент: тексты, структура, бэклог

Черновики сделаны по резюме владельца. Владелец правит факты и тон; агент использует их как рабочий контент вместо «Lorem ipsum» — плейсхолдеры искажают восприятие вёрстки.

---

## 1. Правила тона

Портфолио международное и сдержанное. Значит:

- **Глаголы вместо прилагательных.** Не «опытный разработчик», а «написал решатель для уравнения Ландау–Лифшица».
- **Числа вместо оценок.** Не «крупная инсталляция», а «бюджет $100 000, команда, датчики».
- **Ни одного слова о себе в превосходной степени.** Ни `passionate`, ни `driven`, ни `expert`.
- Первое лицо, короткие предложения, без придаточных на три строки.
- Русская версия — не перевод, а параллельный текст: по-русски можно чуть суше, английский чуть проще синтаксически (уровень B2 автора — это плюс, а не проблема: короткие предложения читаются лучше сложных).
- Название `printor` — всегда строчными.

---

## 2. Строка на главной (≤140 символов)

**EN:** `Computational physicist and R&D engineer. Nonlinear dynamics, simulation software, and free tools for people who make images.`

**RU:** `Физик-вычислитель и R&D-инженер. Нелинейная динамика, софт для симуляций и бесплатные инструменты для тех, кто делает изображения.`

---

## 3. About — черновик

**EN**

> I'm a computational physicist and R&D engineer in Yekaterinburg. My research is on nonlinear dynamics in magnetic chains: I write solvers for the Landau–Lifshitz equation and look for conditions under which atomic vibrations excite magnetic breathers — localized modes that can carry energy along a chain.
>
> Before physics I spent five years in production. I ran a private music academy, produced an independent feature film and a vertical web series, and led the technical side of an interactive museum installation. That work taught me the same thing simulation did: the difficulty is almost never in the idea.
>
> Now I also build small tools and give them away. printor is the first — it makes video look printed and scanned, runs entirely in your browser, and costs nothing. There will be more.
>
> Elsewhere: alpinism, screen printing, and film.

**RU**

> Физик-вычислитель и R&D-инженер, Екатеринбург. Исследую нелинейную динамику в магнитных цепочках: пишу решатели для уравнения Ландау–Лифшица и ищу условия, при которых колебания атомов возбуждают магнитные бризеры — локализованные моды, способные переносить энергию вдоль цепочки.
>
> До физики пять лет занимался продюсированием: руководил частной музыкальной академией, продюсировал независимый полный метр и вертикальный веб-сериал, вёл техническую часть интерактивной музейной инсталляции. Этот опыт научил тому же, чему и симуляции: сложность почти никогда не в идее.
>
> Сейчас ещё делаю небольшие инструменты и раздаю их бесплатно. printor — первый: он делает из видео нечто напечатанное и отсканированное, работает целиком в браузере и ничего не стоит. Будут другие.
>
> Помимо: альпинизм, шелкография, кино.

---

## 4. Projects — стартовый набор

| slug | Название | Год | Теги | Что писать |
|---|---|---|---|---|
| `magnetic-breathers` | Excitation of magnetic breathers via atomic modes | 2025 – now | physics, python | Численный решатель Ландау–Лифшица; поиск порогов по частоте и амплитуде; условия связи атомных и магнитных мод. Статус: идёт. |
| `atomic-breathers` | Simulation of atomic breathers | 2024 – 2025 | physics, python, patent | RK4-решатель, модуль real-time 3D визуализации магнитных текстур, исследование устойчивости на больших выборках. Доклад на конференции, ПО готовится к патенту. |
| `pom-monte-carlo` | Monte Carlo suite for POM functionalization | 2024 – 2025 | python, go, chemistry | Десктоп-приложение (DearPyGui) для команды из 6 исследователей: графовые алгоритмы `.mol` → математическая модель, многопоточность, мост между расчётным модулем на Go и PyMOL для 3D-рендера докинга. |
| `museum-installation` | Interactive museum installation | 2023 | production, hardware | Техническое руководство: аппаратные датчики + визуализация, бюджет $100 000. |
| `feature-film` | Independent feature film & web series | 2021 – 2024 | production | Исполнительный продюсер, бюджет $20 000: фандрейзинг, логистика, пост-продакшн. |
| `music-academy` | Private music academy | 2019 – 2024 | production, management | Операционное руководство: команда до 60 человек, 230 активных студентов. |

Формат карточки проекта: заголовок, моно-таблица (`role / year / status / stack / link`), 2–4 абзаца, при наличии — одна иллюстрация.

---

## 5. Tools

| slug | Имя | Статус | Строка |
|---|---|---|---|
| `printor` | printor | live | Turns video into printed-and-scanned frames. Dither or halftone. Runs on your device. |
| `proxiguesse` | proxiguesse | in development | — |

Правило раздела: **описание инструмента говорит, что он делает, а не какой он хороший.** Одна строка, глагол на первом месте.

---

## 6. Бэклог статей

Сильная сторона автора — редкое сочетание тем; посты должны это использовать, а не прятать. Порядок публикации осмысленный: первая статья соединяет обе половины биографии.

| # | Заголовок (рабочий) | Теги | Зачем |
|---|---|---|---|
| 1 | Dithering is quantization noise with a plan | print, physics, math | Соединяет физику и printor: error diffusion как noise shaping. Лучшая первая статья. |
| 2 | Video processing in the browser, with no server at all | web, tools | Технический разбор printor: WebCodecs + WebGL2. Работает и как документация. |
| 3 | Solving Landau–Lifshitz with RK4: where it lies to you | physics, python | Дрейф энергии, выбор шага, чем платят за неявные схемы. |
| 4 | What a breather actually is | physics | Объяснение без математики, затем с математикой. Проверка конвейера формул. |
| 5 | Real-time 3D in Matplotlib: how far it goes, and when to stop | python, viz | |
| 6 | Bridging Go and PyMOL: the ugly parts | go, python | |
| 7 | A $20,000 feature film: the line items that mattered | production | Другая половина биографии, без ностальгии. |
| 8 | Why this site weighs 14 kB | web, meta | Замыкает петлю; хорошо расходится в профильных сообществах. |

Ритм: одна статья в месяц. Больше — не нужно; портфолио живёт списком проектов, а не частотой постов.

---

## 7. Что нужно от владельца

- [ ] `logo.svg` → `apps/site/src/`
- [ ] CV (PDF + исходник) → `docs/cv/`
- [ ] ссылки: Instagram, Telegram, LinkedIn, GitHub, телефон, почта (агент не берёт их из резюме сам — это персональные данные, нужно явное подтверждение, что публикуем)
- [ ] текстуры для printor → `apps/printor/public/textures/`
- [ ] фактчек черновиков в §3–§4: годы, бюджеты, формулировки статуса патента
