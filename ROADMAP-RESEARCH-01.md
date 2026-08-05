---
type: roadmap-research-input
part: 1
date: 2026-08-05
source: ChatGPT deep research (external, unverified — treat claims about repo state as hypotheses to check, not fact)
language: ru
status: raw — not yet reviewed, not a decision, not ROADMAP.md itself
---

# Roadmap research — part 1

**What this file is:** raw output from a ChatGPT "deep research" pass on BloxForge v4.1.0, kept
as input material for building `ROADMAP.md`. It is not the roadmap, not reviewed, and not
approved — treat every claim in it (especially about current repo state, bugs, or missing
features) as something to verify against the actual code before acting on it.

**How to use this file (for a human or an AI agent):**
1. Read it for ideas and structure, not as ground truth.
2. Before citing any specific claim (e.g. "X is missing", "Y is broken"), verify it against the
   current codebase — the research was generated from a snapshot and may already be stale.
3. Subsequent research passes get added as `ROADMAP-RESEARCH-02.md`, `-03.md`, etc. Once enough
   parts accumulate and get reviewed, they should be distilled into an actual `ROADMAP.md`.
4. Original text is in Russian; do not assume it needs translating to be useful — read/summarize
   in place.

**Claims already checked against the code (2026-08-05).** This pass carries `[проверено: …]`
markers, and they are not all reliable — one confident "not found" was wrong about our own code:

| Claim | Verdict |
|---|---|
| `docs/architecture.md` still says "130+ tools" | True — fixed |
| README and Architecture contradict each other on Wally `--locked` | True — the code emulates the flag by backing up the lockfile, so README was the wrong one; fixed |
| Plugin pins TypeScript 5.5.3 while the monorepo uses 6.0.3 | True |
| Coverage ratchet is 60.77 / 50.57 / 53.68 / 62.41 | Accurate quote of a stale CHANGELOG; `jest.config.js` holds 61 / 51 / 54 / 62.8 — fixed |
| No `ScriptDocument` / `ScriptEditorService` draft-awareness in BloxForge | **False.** `Utils.readScriptSource` reads the live draft via `FindScriptDocument().GetText()`, and `ScriptHandlers` writes through `UpdateSourceAsync`. The report hedged this as a search limitation and then proposed it as a 64–96h task anyway. A "not found" is not a "not there". |

---

BloxForge v4.1.0: технический аудит, ROADMAP и техническое задание
Резюме для руководителя

BloxForge v4.1.0 уже нельзя считать экспериментальным MCP-плагином для «поставить куб в Workspace». Это достаточно зрелая локальная платформа автоматизации Roblox Studio: Node.js/TypeScript-сервер, Studio-плагин на roblox-ts, два MCP-транспорта, управление несколькими DataModel, безопасные plan/apply-операции, playtest-автоматизация, asset-инструменты, интеграции Rojo/Rokit/Wally, профили доступа, журналирование и развитый CI. [проверено: репозиторий и документация проекта]

Релиз v4.1.0 от 5 августа 2026 года правильно сфокусировался на снижении стоимости чтения: были ограничены шумные деревья DataModel, уменьшены скриншоты, исправлено дублирование structuredContent, восстановлена фактическая работа load_toolset через Streamable HTTP, введены Asset Manifest v1, undo-контракт для generated-Luau и дополнительные CI-проверки. [проверено: CHANGELOG v4.1.0]

Главный оставшийся продуктовый разрыв находится не в количестве инструментов. В BloxForge уже 213 инструментов и практически все необходимые низкоуровневые примитивы. Разрыв находится между ними:

    агент умеет читать, создавать и изменять объекты, но пока не имеет формальной модели художественного намерения, пространства, модульного набора, композиции и качества результата.

Поэтому следующий крупный этап развития должен быть не очередным расширением CRUD, а появлением трёх высокоуровневых слоёв:
Целевой слой	Задача
Scene Intelligence	Преобразовать дерево Instances в зоны, маршруты, ориентиры, проходимость, видимость, композиционные кадры и измеримые проблемы сцены.
World Authoring Plans	Преобразовать запрос пользователя в воспроизводимый план: style brief → blockout → modular kit → asset placement → dressing → lighting → QA.
Asset Intelligence	Сделать поиск готовых моделей частью основного workflow, а не необязательным набором отдельных инструментов: локальный каталог, оценка кандидатов, карантин, нормализация, подгонка к сцене и повторное использование.

Критическая цепочка зависимостей выглядит так:

text

Benchmark places и eval-набор
        ↓
Style Profile + Semantic Scene Index
        ↓
Asset Catalog + Asset Fit/Sanitize
        ↓
Modular/Scatter/Spline Plans
        ↓
Multi-view Visual Review + Navigation QA
        ↓
Studio authoring dashboard
        ↓
Windows Studio canary + release quality gates

Рекомендуемый горизонт:
Горизонт	Результат	Чистые трудозатраты
MVP	Измерение агентных сессий, Style Profile, Scene Index v1, asset quarantine/fit, фиксированный review-набор кадров	8–10 недель одного инженера
Среднесрочный	Модульные киты, scatter, маршруты, композиционный lint, authoring-панель плагина	ещё 10–14 недель
Долгосрочный	Полноценный semantic world planner, генеративные биомы, spline-системы, visual regression и real-Studio release gate	6–12 месяцев суммарно

Состав команды, доступный бюджет, целевые жанры Roblox, минимальные устройства, эталонный художественный стиль и допустимое использование внешних AI/API не указаны. Оценки ниже даны в чистых инженерных часах для одного опытного TypeScript/Roblox-инженера; один рабочий день принят равным 8 часам. Работа технического художника и ручная QA-оценка указаны отдельно, где необходимы.

Исходные ограничения и перечень уже реализованных функций приняты из приложенного проектного брифа; задачи ниже намеренно не повторяют уже существующие get_scene_summary, capture_screenshot, playtest-инструменты, Marketplace/Open Cloud, provenance, Asset Manifest v1, планирование Rojo и другие перечисленные возможности.
Аудит текущего состояния и релиза

Состояние кодовой базы. [проверено: package.json] Репозиторий является npm-workspaces-монорепозиторием версии 4.1.0, требует Node.js 20+, включает общее ядро, основной MCP-сервер, read-only Inspector и отдельный Studio-плагин. Корневые команды охватывают сборку, lint, typecheck, Jest, coverage, fault injection, plugin smoke/runtime, Rojo/Rokit/Wally integration, проверку документации, tarball и полный release gate.

packages/core действительно не содержит runtime-зависимостей: Express, WebSocket, MCP SDK и тестовые пакеты находятся в devDependencies. Это сильное архитектурное ограничение, которое следует сохранить. Основной публикуемый CLI-пакет содержит runtime-зависимости от MCP SDK, Express и ws. [проверено: package manifests]

Плагин компилируется через rbxtsc из TypeScript в Luau и зависит от roblox-ts и @rbxts/services. При этом плагин закреплён на TypeScript 5.5.3, а основное монорепо использует TypeScript 6.0.3. [проверено: package manifests] Это не ошибка само по себе, поскольку совместимые версии roblox-ts могут требовать отдельную ветку TypeScript, но это создаёт риск расхождения синтаксиса, типов и lint-поведения.

Архитектура. [проверено: архитектурная документация] MCP-клиент вызывает Node-сервер, сервер общается с Roblox Studio через локальный HTTP/WebSocket-мост, а плагин выполняет команды в DataModel. Плагин намеренно тонкий; orchestration, эффекты, авторизация, response formatting и safety находятся на Node-стороне. Транспорт использует request ID, lease, acknowledgement, дедупликацию, bounded result cache, журнал восстановления, outcome_unknown, session credentials и ограничения параллелизма.

В документации есть признаки drift. Например, верхняя диаграмма всё ещё говорит о «130+ tools», тогда как текущий бриф и релизные материалы указывают 213. README и Architecture также различаются в описании поведения Wally при отсутствии --locked: README говорит об отказе от запуска, а Architecture описывает резервное копирование и восстановление lockfile. [проверено: текущие документы; фактическое runtime-поведение требует отдельного запуска pinned-интеграции]

Релиз v4.1.0. [проверено: CHANGELOG] В релиз вошли:
Область	Подтверждённое изменение	Значение
Токены	Фильтрация внутренних и пустых сервисов в корневом get_file_tree	Устраняет крупнейший источник случайного контекста
Скриншоты	Downscale до 1568 px по умолчанию	Снижает payload при сохранении координатной совместимости
MCP output	structuredContent только для инструментов с outputSchema	Устраняет дублирование
Discovery	Исправлен load_toolset через /mcp	Ленивая загрузка теперь действительно меняет список
Assets	Asset Manifest v1 и сканирование локальных файлов	Создаёт основу воспроизводимого asset pipeline
Safety	Undo-recording для generated-Luau mutations	Делает большие генеративные операции обратимыми
Protocol	Отказ от старых протоколов плагина ниже v3	Fail-closed вместо тихого ослабления гарантий
Quality	Coverage ratchet и проверки argument/undo/docs	Предотвращает повторение нескольких классов дефектов

Текущий coverage ratchet установлен примерно на 60,77% statements, 50,57% branches, 53,68% functions и 62,41% lines. [проверено: CHANGELOG] Это разумный минимальный барьер, но он измеряет выполнение строк, а не корректность поведения внутри реального Roblox Studio.

CI/CD. [проверено: workflow-файлы] CI выполняется на Node 20 и 22, компилирует плагин, запускает plugin runtime smoke, fault-injection и 10k transport benchmark, тестирует pinned Rojo 7.7.0 и Rokit 1.2.0, а также выполняет Windows/macOS smoke. Release workflow разделяет read-only quality gate, публикацию npm с provenance и минимальный write-job для загрузки .rbxmx в GitHub Release. Это сильная реализация least privilege.

Главный пробел CI: Windows/macOS jobs проверяют Node, файлы, пакет и скомпилированный Luau, но не выполняют систематический набор действий внутри настоящего Roblox Studio с контрольным place. [проверено: workflow-файл; вывод из отсутствия Studio canary job]

Плагинный UX. [проверено: код UI.ts] Текущий DockWidget в основном управляет соединением: URL, состояние HTTP/MCP, вкладки нескольких подключений, индикаторы и update banner. UI вручную создаёт большое дерево Roblox GUI Instances. Полноценной рабочей области для планов, ассетов, scene review, quality findings и истории операций в этом модуле не обнаружено.

Issues и PR. На момент аудита публичный GitHub Issues API для BloxForge не вернул активного пользовательского backlog; это следует трактовать только как отсутствие публично заведённых issue, а не как отсутствие дефектов. Основным источником сведений о найденных проблемах являются release PR и подробный CHANGELOG. PR v4.1.0 затронул транспорт, tool pipeline, scene reads, assets, plugin communication, документацию и несколько новых CI-проверок. [проверено: GitHub API и список файлов PR №68, 5 августа 2026 года]

Примеры использования. README содержит quick start и несколько prompt-сценариев, а в репозитории есть eval harness и fixture-директория. Однако существующие примеры ориентированы преимущественно на запуск и функциональную автоматизацию; публичного набора из нескольких визуально законченных benchmark places с golden screenshots и измеримым quality score в найденной структуре не подтверждено. [проверено: README и индекс файлов evals; отсутствие — результат поиска, а не доказательство невозможности существования в иной ветке]

Технический диагноз.
Область	Оценка	Следующий шаг
Транспорт и безопасность	Сильная	Не переписывать; добавить conformance и real-Studio canary
Низкоуровневые Studio tools	Очень широкое покрытие	Прекратить рост «по одному tool на действие» без orchestration
Токен-эффективность	Уже существенно улучшена	Перейти к измерению полезности, snapshot cursors и A/B форматам
Scene understanding	Хорошие сводки, слабая пространственная семантика	Ввести Semantic Scene Index
Assets	Много источников и операций, слабая интеграция в map workflow	Ввести asset-first planning, fit и quarantine
Генерация карт	Есть building primitives, но нет художественного pipeline	Ввести World Plan, modular kit, scatter и spline layers
Plugin UX	Connection console	Превратить в review/authoring dashboard
QA	Сильные unit/transport checks	Добавить benchmark places, visual regression и Studio contract tests
Документация	Подробная, но местами расходится	Ввести executable claims и docs truth table
Токен-эффективность и агентный контекст

Выводы.

Текущие оптимизации v4.1.0 уже закрывают очевидные источники мусора: внутренние сервисы, пустые узлы, лишний Source, дублирование structuredContent, чрезмерное разрешение скриншота и стартовую публикацию всех 213 схем. Их не следует реализовывать повторно. [проверено: CHANGELOG и исходный бриф]

Оставшийся вопрос нельзя решить простым подсчётом байтов. Поле может редко цитироваться агентом, но быть критичным для решения не выполнять опасную операцию. Поэтому «полезность поля» должна оцениваться причинно: сравнивать исходную траекторию с повторным прогоном, где поле удалено, агрегировано или заменено дескриптором. [не проверено: предлагаемая методика для BloxForge; прямого общепринятого стандарта field-level tool-output utility не найдено]

Исследования длинного контекста в function calling показывают значительное ухудшение качества при росте количества инструментов, длины ответов и многошаговой истории. Однако опубликованные величины сильно зависят от модели и benchmark, поэтому их нельзя переносить на BloxForge как прогноз. [проверено: LongFuncEval; применимость чисел к BloxForge не проверена]

Нет надёжного основания глобально заменить JSON на YAML, TSV или новый формат. Исследование на 9649 экспериментах не обнаружило значимого общего преимущества формата для accuracy, зафиксировало модельно-зависимую чувствительность и показало, что более компактное представление иногда увеличивает фактическое потребление токенов из-за менее привычных паттернов поиска. [проверено: preprint Structured Context Engineering]

Другие исследования находят, что плоские табличные данные можно передавать дешевле в hybrid CSV/prefix или columnar-форматах, но JSON остаётся надёжнее для сложных вложенных структур. [проверено: опубликованное сравнительное исследование и preprint; tool-result use отличается от structured-output generation]

Практический вывод: сохранить JSON в structuredContent, а компактный row-oriented формат тестировать только в текстовом compatibility-канале и только для однородных списков. Это не ломает MCP-контракт и позволяет старым клиентам продолжать читать content.

MCP поддерживает pagination для tools/list, уведомление об изменении списка и typed structured output при объявленном outputSchema. [проверено: MCP specification]

Для prompt caching важен стабильный идентичный префикс. Изменение, добавление или перестановка инструментов в начале контекста может инвалидировать последующую кэшируемую часть у клиентов, использующих prefix caching. [проверено: официальная документация Anthropic по prompt caching; конкретное поведение каждого MCP-хоста BloxForge не проверено]

Рекомендуемая методика измерения полезности.

Для каждой eval-траектории сохраняется локальный, обезличенный trace:

text

taskId
modelFamily
tool name + schema revision
arguments hash
response shape revision
field-path inventory
response bytes/tokens
next tool/action
final verdict
extra calls
human/automatic assertions

Payload по умолчанию не сохраняется. Для approved benchmark places можно включать fixture payloads. Затем запускаются четыре режима:
Режим	Проверяемый вопрос
Baseline	Как агент выполняет задачу сейчас
Field ablation	Меняется ли решение, если убрать конкретное поле
Summary only	Делает ли агент корректный drill-down или начинает угадывать
Compact serialization	Меняется ли успех при row-oriented text при том же structuredContent

Поле считается полезным, если его удаление хотя бы по одному классу задач статистически повышает число неверных решений, повторных вызовов, unsafe attempts или итоговых failures. Простая проверка «упомянул ли агент значение в следующем вызове» должна использоваться только как дешёвый индикатор, не как основной критерий.

Что осталось непроверенным.
Неизвестное	Причина
Какая доля полей BloxForge реально влияет на следующий шаг	Нет опубликованного корпуса живых BloxForge-траекторий
Как Claude Code, Cursor, Codex и Gemini кэшируют динамические MCP tool lists	Поведение зависит от конкретного клиента и версии
Делает ли агент drill-down после summary или угадывает	Требуется replay eval на реальных задачах
Насколько TSV/rows лучше именно для Roblox tree/property data	Внешние исследования используют другие домены
Можно ли безопасно убрать name, если он выводится из path	Требуется измерить ошибки реконструкции, особенно с точками и нестандартными именами
Реальные токены разных моделей	Tokenizer и accounting клиента не указаны

Технические предложения.
Задача	Эффект	Усилие	Зависимости	Критерий приёмки	Ограничение
Local Agent Trace v1	Даёт основание для всех следующих оптимизаций	S, 32–48 ч	eval harness	Ни один payload не сохраняется без opt-in; trace воспроизводим по fixture ID	Локальность
Field-utility replay runner	Находит поля, которые можно удалить или агрегировать	S, 48–72 ч	trace v1, benchmark tasks	Для 20+ задач выполняются автоматические ablation-прогоны	Fail closed
responseFormat: json-text | rows для плоских списков	Ожидаемо 15–35% экономии text-канала; число предварительное	S, 32–48 ч	replay runner	Не более 1 процентного пункта падения task success; structuredContent неизменён	Совместимость
Snapshot cursor вместо одного offset	Исключает дрейф страниц при изменении сцены	S, 40–64 ч	scene read layer	Cursor привязан к snapshotId, TTL и response-shape revision	Fail closed
Summary + continuation descriptor	Меньше контекста для больших деревьев	S, 40–64 ч	snapshot cursor	Агент успешно находит целевой объект в ≥95% benchmark-задач	Локальность
Schema confusion benchmark	Определяет оптимальную длину описаний	S, 32–48 ч	eval harness	Confusion matrix по 29 core tools и похожим парам	—
Стабильная сортировка и schema revision	Улучшает шанс prompt-cache hit	S, 16–24 ч	registry	Одинаковая конфигурация даёт байт-в-байт одинаковый tools/list	Совместимость
pathMode: full | relative	Убирает повторяющиеся префиксы	S, 24–40 ч	row format	Default остаётся full; relative покрыт round-trip тестом	Совместимость
Derived-field audit	Проверяет name, path, parent path, class counts	S, 24–32 ч	utility traces	Поле удаляется из compact mode только после ablation gate	Fail closed

Решение по дедупликации. Поля name и полный path не следует молча удалять из существующих ответов. Нужно добавить опциональный компактный режим:

json

{
  "root": "Workspace.Environment",
  "columns": ["relativePath", "class", "size"],
  "rows": [
    ["Trees/Pine_01", "Model", [4.2, 18.0, 4.1]]
  ]
}

В default-режиме сохраняется старый контракт. В compact-режиме name выводится из последнего сегмента только библиотечной функцией BloxForge, а не оставляется на реконструкцию модели. Имена, содержащие разделитель, должны передаваться как сегменты или escaped values.
Понимание сцены, дизайн карт и UX плагина

Операционное определение «красиво».

Roblox рекомендует workflow greybox → polished assets → asset library → world construction → optimization, а не немедленное украшение пустого уровня. Официальный environmental-art curriculum отдельно подчёркивает art style, modular kits, trim sheets, согласованные pivot points, сетку, props, силуэт, повторное использование и регулярное тестирование с разных ракурсов. [проверено: Roblox Creator Hub]

Таким образом, «красиво» для BloxForge следует представить не одним непрозрачным score, а набором проверяемых свойств:
Измерение	Машинно проверяемые признаки	Оценка моделью или человеком
Композиция	Наличие focal points, screen-space dominance, отсутствие случайных перекрытий	Читаемость главного объекта
Силуэт	Доля крупных форм, различимость landmark с заданных кадров	Узнаваемость и характер
Навигация	Достижимость зон, количество тупиков, видимость ориентиров	Понятность пути без подсказки
Палитра	Число доминирующих цветов, контраст зон, выбросы	Целостность настроения
Масштаб	Отношения дверей, проходов, укрытий и props к реальному player rig	Правдоподобность
Детализация	Плотность props на площадь, повторяемость, variation entropy	Отсутствие пустоты и визуального шума
Материалы	Наличие PBR-наборов, повторное использование trim sheets, конфликтующие материалы	Художественная согласованность
Освещение	Экспозиция, пересвеченные/проваленные области, контраст маршрута	Настроение и фокус
Техническое качество	Z-fighting, intersecting geometry, scripts в asset, unanchored statics, бюджеты	—
UI	Контраст, touch targets, overflow, safe areas, text scaling	Иерархия и ясность

Официальный curriculum советует согласованные pivot points, размеры modular pieces, кратные минимальному модулю, и только ту геометрию props, которая нужна для узнаваемого силуэта. [проверено: Roblox Creator Hub]

Semantic Scene Index.

Существующие get_world_snapshot, get_scene_analysis и поисковые инструменты следует оставить источниками фактов, а поверх них построить локальный производный индекс:

mermaid

flowchart LR
    DM[Roblox DataModel] --> EX[Plugin extractors]
    EX --> GEO[Geometry layer]
    EX --> SEM[Tags and attributes]
    EX --> MAT[Material and asset layer]
    EX --> UI[GUI layer]
    GEO --> IDX[Semantic Scene Index]
    SEM --> IDX
    MAT --> IDX
    UI --> IDX
    IDX --> Z[Zones and rooms]
    IDX --> R[Routes and reachability]
    IDX --> L[Landmarks and visibility]
    IDX --> C[Composition shots]
    IDX --> Q[Quality findings]
    IDX --> P[World authoring plans]

Индекс не должен копировать весь DataModel. Он хранит digest и производные данные: bounding boxes, spatial cells, semantic tags, asset identity, material signature, route samples, view samples и confidence.

Предлагаемая модель сущностей:

ts

interface SemanticZone {
  id: string;
  source: "tag" | "attribute" | "inferred";
  kind: "spawn" | "route" | "arena" | "room" | "landmark" | "transition" | "background";
  bounds: OrientedBounds;
  entrances: string[];
  styleProfileId?: string;
  confidence: number;
}

interface RouteProbe {
  fromZone: string;
  toZone: string;
  agentProfile: string;
  status: "reachable" | "blocked" | "partial" | "unknown";
  waypointCount?: number;
  blockingRegion?: Bounds;
}

interface SceneFinding {
  ruleId: string;
  severity: "info" | "warning" | "error";
  instancePaths: string[];
  evidence: Record<string, unknown>;
  suggestedAction?: string;
}

Сначала индекс должен предпочитать явные теги и атрибуты. Инференс используется только как fallback и обязательно возвращает confidence. Это соответствует fail-closed: низкая уверенность не превращается в автоматическую mutation.

Проходимость и комнаты.

PathfindingService позволяет рассчитывать путь с параметрами агента; официальная документация указывает ограничения до 3000 studs прямого расстояния и до 20 000 nodes на запрос. [проверено: Roblox pathfinding reference]

Следовательно, не следует пытаться «выгрузить весь navmesh» через неподтверждённый API. Реалистичный v1:

    Получить явные или предполагаемые зоны.
    Создать ограниченный набор probe points на полу.
    Выполнить pairwise path probes только между соседними зонами.
    Сохранить waypoint chain, failure status и время.
    При превышении лимита разбить маршрут на spatial chunks.
    Проверить несколько agent profiles: стандартный персонаж, крупный NPC, персонаж без прыжка.

Определение помещений можно реализовать как 2.5D occupancy-анализ: bounded grid, raycast/box overlap, flood fill внешнего пространства и поиск внутренних connected components. [не проверено: гипотеза; это собственный алгоритм, а не официальная возможность Roblox] Результат должен называться inferredRoom, содержать resolution и confidence и не применяться к произвольным вертикальным мирам без предупреждения.

Визуальная обратная связь.

Один случайный screenshot недостаточен для 3D-композиции. Нужен стандартный review set:
Кадр	Назначение
Top-down perspective	Зоны, маршруты, плотность, симметрия
Player-eye spawn	Первое впечатление
Player-eye primary route	Читаемость пути
Landmark close/medium	Силуэт и фокус
Four cardinal views	Перекрытия и пустые фасады
Lighting dark/bright probes	Динамический диапазон
Device UI matrix	GUI и читаемость
Debug overlay	Bounds, semantic zones, path failures

Истинной ортографической камеры в предложении не следует обещать без проверки соответствующего Studio API. Для top-down можно использовать perspective-камеру с большим расстоянием и узким FOV либо отдельную схематическую 2D-карту. [не проверено: точная визуальная эквивалентность ортографической проекции]

Reference-driven workflow.

BloxForge не должен сам притворяться vision-моделью. Извлечение параметров из изображения выполняет MCP-клиентская мультимодальная модель; BloxForge принимает и хранит структурированный Style Profile:

json

{
  "version": 1,
  "name": "stylized-coastal-industrial",
  "palette": {
    "dominant": ["#738B8B", "#D6C39A"],
    "accent": ["#E8734A"],
    "forbidden": []
  },
  "forms": {
    "primary": ["large rectangular masses", "rounded frame details"],
    "silhouette": "chunky-low-frequency"
  },
  "materials": ["painted-metal", "concrete", "weathered-wood"],
  "modularGridStuds": 4,
  "detailDensity": {
    "hero": 0.8,
    "route": 0.45,
    "background": 0.15
  },
  "lighting": {
    "mood": "warm sunset",
    "keyDirection": [0.4, -0.7, 0.5]
  }
}

style_profile_plan валидирует профиль, показывает затрагиваемые зоны и выдаёт planHash. style_profile_apply может создавать только tags, attributes, palette mappings и material-role assignments; массовое переоформление сцены должно иметь отдельный plan.

UI quality.

Roblox рекомендует достаточный контраст, увеличение текста, отказ от передачи смысла только цветом или звуком и поддержку PreferredTransparency, PreferredTextSize и ReducedMotionEnabled. [проверено: Roblox accessibility guide]

Для численной проверки можно использовать WCAG 2.2 как внешний ориентир: 4.5:1 для обычного текста, 3:1 для крупного текста и минимум 24×24 px либо достаточный spacing для targets уровня AA; 44×44 px является более строгой рекомендацией уровня AAA. [проверено: W3C; Roblox не заявляет формальную обязательность WCAG для всех experiences]

ui_quality_audit должен рассчитывать абсолютные bounds на каждом устройстве из capture_device_matrix, проверять:

    contrast текста и фона;
    target size и расстояние до соседних controls;
    выход за viewport/safe inset;
    clipping и zero-size;
    переполнение текста;
    результат при PreferredTextSize = Largest;
    поведение при reduced motion;
    зависимость смыслового статуса только от цвета.

Что осталось непроверенным.
Неизвестное	Статус
Доступен ли plugin-коду navmesh как перечислимые полигоны	Не подтверждено официальной документацией
Можно ли получить точный triangle count каждого Marketplace mesh до вставки	Не подтверждено
Качество room inference на многоэтажных или вертикальных картах	Требуется prototype
Насколько vision-модель стабильно оценивает композицию по review set	Требуется model-specific eval
Универсальные Roblox performance budgets	Не существуют как один достоверный набор; нужны device tiers
Целевые жанры и размеры карт BloxForge	Не указано
Арт-стиль и допустимый диапазон художественной вариативности	Не указано

Технические предложения.
Задача	Эффект	Усилие	Зависимости	Критерий приёмки	Ограничение
style_profile_status/plan/apply	Делает стиль явным и воспроизводимым	S, 48–72 ч	plan hashing	Unknown keys rejected; apply требует актуальный hash	Plans immutable
Semantic Scene Index v1	Зоны, bounds, semantic tags	M, 80–120 ч	benchmark places	Индекс 10k Instances строится в заданный бюджет; точный бюджет определяется baseline	Core без deps
Zone inference v1	Находит функциональные области	M, 64–96 ч	scene index	Каждая inferred zone имеет evidence/confidence	Fail closed
Route probe matrix	Ловит недостижимые зоны	M, 80–120 ч	semantic zones	Все tagged entrances проверены минимум двумя profiles	Studio API
Room inference prototype	Находит закрытые пространства	M, 80–120 ч	spatial grid	≥90% совпадения с ручной разметкой на indoor fixture	Гипотеза
capture_review_set	Стабильный визуальный feedback loop	S, 40–64 ч	screenshot tool	Одинаковые именованные ракурсы, restore камеры гарантирован	Совместимость
Composition overlay	Показывает zones/routes/landmarks	S, 48–72 ч	scene index	Overlay временный и полностью очищается	Локальность
scene_quality_audit v2	Формализует z-fighting, scale, density	M, 80–120 ч	scene index	Каждый finding содержит evidence и instance paths	Явные эффекты
ui_quality_audit	Контраст, targets, safe areas, preferences	M, 48–80 ч	device matrix	Проверено на phone/tablet/desktop fixtures	Локальность
Review dashboard в плагине	Человек видит plan/findings/assets	L, 120–200 ч	API для review state	Tabs: Plans, Scene, Assets, Review, Performance	TS→Luau
Human pairwise review harness	Не даёт оптимизировать «красоту» по шумному score	S, 32–48 ч	golden scenes	Reviewer сравнивает A/B без знания версии	—
Готовые модели, ассеты и анализ upstream-проекта

Почему агент может не использовать уже существующие asset-инструменты.

Набор BloxForge уже включает поиск, thumbnails, isolated preview, insertability preflight, ranking, внешние CC0-источники, импорт, provenance и Asset Manifest. [проверено: определения tools и проектный бриф]

Проблема заключается в orchestration. plan_asset_insert решает один keyword search, но map-building workflow не обязан вызывать его. Агент может сразу создать примитив, потому что:
Причина	Состояние
Нет общего asset-first policy для world plan	[вывод из текущего набора независимых инструментов]
Нет persistent local catalog с semantic roles	[не найдено в проанализированных definitions]
Нет fit score относительно style profile и целевой зоны	[не найдено]
Нет обязательного quarantine/sanitize plan перед фактическим parenting	Preflight есть, но это ещё не нормализованный safe copy
Нет reusable modular-kit registry	Не подтверждено
Нет метрики asset reuse ratio	Не подтверждено
Примитивная генерация обычно требует меньше tool round-trips	[гипотеза, требуется trace]

Доступность и качество метаданных.

Creator Store предоставляет поиск и сведения об assets, а Studio даёт доступ к миллионам моделей, meshes, изображений и других ресурсов. [проверено: Roblox Creator Hub]

До загрузки обычно доступны catalog metadata и thumbnail, но точные габариты и содержимое иерархии нельзя считать гарантированными marketplace-полями. BloxForge уже правильно использует фактический isolated AssetService:LoadAssetAsync как authoritative preflight. [проверено: BloxForge tool definition; точный список публичных Creator Store полей зависит от API version]

Полигонаж, точная texture memory и полноценная license classification до загрузки модели не подтверждены как универсально доступные поля Creator Store API. [не проверено: официального контракта с такими полями не найдено] Поэтому asset ranker не должен выдумывать их. В v1 можно использовать измеримые proxy:

text

descendant count
BasePart/MeshPart count
unique MeshId count
texture and SurfaceAppearance count
script/module count
joint/constraint count
unanchored static count
bounding box
pivot location
collision settings
nested model depth
external asset references

Безопасность чужих моделей.

Существующий preflight уже загружает asset в изолированный непарентированный контейнер, считает scripts и уничтожает результат. [проверено: tool definition]

Следующий шаг — не «сразу вставить после preflight», а создать asset_sanitize_plan:

text

Load candidate
  ↓
Hash complete hierarchy and relevant properties
  ↓
Classify executable content
  ↓
Show removals/rewrites
  ↓
Clone sanitized tree
  ↓
Normalize pivot/scale/collision
  ↓
Parent only after planHash confirmation

Политики:
Политика	Поведение
scripts: deny	Любой Script/LocalScript/ModuleScript блокирует apply
scripts: strip	Plan перечисляет каждый удаляемый executable object
scripts: review	Source hashes и пути возвращаются для отдельного аудита
externalReferences: warn	Mesh/texture/sound references включаются в evidence
unknownClass: deny	Неизвестный исполняемый/контейнерный класс блокирует apply

Нельзя утверждать, что «непарентованный asset абсолютно безопасен» без проверки всех классов и engine semantics. Поэтому isolated preflight следует считать уменьшением риска, а не полноценной sandbox-гарантией. [не проверено: абсолютная безопасность unparented hierarchy]

Нормализация модели к сцене.

Автоматизируемые части:
Операция	Автоматизация
Scale	Fit по целевому bounding box, height range или measured player rig
Pivot	Base-center, wall-back, ceiling-top, logical existing pivot
Orientation	Forward/up policy и тест нескольких quarter-turn variants
Placement	Ground/wall/ceiling raycast и clearance check
Anchoring	По role-policy
Collision	Preserve, box proxy, hull-like policy, disabled
Material mapping	Role-based mapping к palette/material profile
Naming/tagging	Semantic role, source asset ID, provenance ID
Variations	Deterministic seed для scale/yaw/material variants

Требующие человека или мультимодальной модели части:

    соответствует ли silhouette стилю;
    корректна ли смысловая ориентация сложного prop;
    насколько material remap разрушает авторский замысел;
    является ли модель визуально качественной;
    допустимо ли повторение конкретного hero asset.

Roblox Importer поддерживает .fbx, .obj и .gltf для 3D-моделей; glTF/FBX могут сохранять несколько mesh objects, hierarchy, texture/PBR и rigging в зависимости от содержимого. [проверено: Roblox import documentation]

Roblox рекомендует PBR-наборы Color, Normal, Roughness и Metalness через SurfaceAppearance, а также проверку материалов при разных вариантах освещения. [проверено: Roblox documentation]

Reimport в Studio может обновлять custom models и textures, сохраняя существующие свойства, а import settings могут переиспользоваться. [проверено: Roblox documentation] Это следует связать с Asset Manifest, но не заменять собственный hash/planHash-контракт BloxForge.

Packages.

Roblox Packages предназначены для повторного использования, versioning и обновления copies. Изменённые copies не получают автоматическое массовое обновление так же, как немодифицированные, что делает аудит modified/outdated copies полезным. [проверено: Roblox Packages documentation]

Возможность получить через Open Cloud полный список всех modified package copies в открытом Studio place не подтверждена. [не проверено] Реалистичный package_audit должен работать Studio-side по доступным Instance/package metadata и отдельно сообщать unknown, когда версия или modified state не могут быть доказаны.

Источники вне Roblox.

Poly Haven, ambientCG, Kenney и Quaternius уже включены в BloxForge, поэтому расширять список источников сейчас не является приоритетом. Сначала нужно повысить вероятность выбора и повторного использования уже найденных assets. [проверено: BloxForge tool definition]

Приоритет источников рекомендуется установить так:

text

Project-owned local catalog
    ↓
Project Roblox Packages
    ↓
Previously approved provenance catalog
    ↓
Creator Store vetted candidates
    ↓
CC0 external providers
    ↓
Procedural primitive generation

Это сохраняет локальность: внешние вызовы происходят только после явного разрешения policy allowExternalSearch.

Сравнение с Chrrxs/robloxstudio-mcp.

Upstream-проект активен: последний найденный релизный commit v2.23.1 датирован 2 августа 2026 года; его README указывает 78 инструментов и фокус на runtime debugging, playtest, screenshots/input, profiler и eval. [проверено: GitHub repository и commit history]

По количеству инструментов BloxForge значительно шире. Полезные отличия upstream находятся в отдельных механизмах:
Механизм upstream	Есть в BloxForge	Оценка заимствования
Чтение встроенных Studio Assistant skills из локального Assistant.rbxm	По поиску кода не обнаружено	Экспериментально, низкий приоритет
Собственный parser RBXM chunk-структуры для skills	Не обнаружен	Не переносить в core без отдельной justification
Zstd через fzstd и собственный LZ4 decode	Core BloxForge без runtime deps	Несовместимо с текущим core policy
WSL Studio lifecycle hardening	Явного эквивалента поиском не найдено	Стоит исследовать, если WSL входит в support matrix
Structured data у live LogService entries	Полная parity BloxForge не подтверждена	Провести contract comparison
Compact Creator Store audio previews	Не подтверждено	Низкий приоритет для map-building
Built-in Studio skills discovery	Отсутствует	Полезно для синхронизации с нативными практиками Studio, но хрупко

Код upstream studio-skills.ts локально ищет установленный Assistant.rbxm, разбирает Roblox binary model chunks, извлекает StringValue с SKILL/SKILL-combined, парсит frontmatter, вычисляет hashes и кэширует результат по mtime/size. [проверено: исходный файл upstream]

Стоит ли переносить:

    Не в packages/core. Upstream использует fzstd, а BloxForge core не имеет runtime dependencies.
    Не как стабильную гарантию. Путь к встроенному bundle и формат его содержимого являются внутренней деталью установленного Studio, а не найденным публичным API-контрактом.
    Возможно как optional experimental adapter. Отдельный пакет packages/studio-skills-adapter либо CLI-side feature с явным capability, hash и version reporting.
    Fail closed. Не найден bundle, неизвестный compression chunk или изменившийся формат — ошибка с инструкцией, а не пустой список skills.

Issues upstream дают полезные регрессионные сценарии: несинхронизированные ScriptDocument drafts, зависание stop-playtest, потеря structured Output data, проблемы routing server/client, отсутствие screenshot/input во время Play Solo и конфликты временных bridge scripts. [проверено: публичные upstream issues через GitHub API]

Даже если часть этих дефектов уже исправлена в BloxForge, их следует перенести как adversarial tests:
Upstream-сценарий	BloxForge regression test
Открытый script с unsaved draft	Read/edit обязан обнаружить конфликт draft vs Source
Manual playtest → MCP stop	Stop должен завершить peers или вернуть доказуемый terminal status
Edit → Play Solo screenshot	Frame source должен соответствовать выбранному DataModel
Explicit server/client-1 routing	Target identity не меняется между вызовами
Bridge scripts после stop	Temporary objects отсутствуют в edit tree и drafts
Expanded Output table	Возвращается structured data либо documented limitation
Local model вызывает resources/list	Сервер возвращает поддерживаемый MCP response или ясную capability result

Поиск BloxForge-кода не обнаружил явного использования ScriptDocument/ScriptEditorService для live draft-awareness. [проверено: repository code search; возможны динамически сформированные строки, не попавшие в индекс] Это более приоритетное заимствование из upstream issues, чем parser встроенных skills: silent overwrite unsaved draft является риском потери пользовательской работы.

Что осталось непроверенным.
Неизвестное	Причина
Полный semantic diff всех tool definitions двух репозиториев	Connector не предоставил единый tree/archive; сравнение выполнено по коду и поиску ключевых механизмов
Runtime correctness upstream skills parser на текущем Studio	Не запускался на локальной Studio installation
Есть ли BloxForge equivalent WSL lifecycle под другим именем	Поиск не нашёл, но динамические/неиндексированные реализации возможны
Полнота structured data в BloxForge runtime logs	Требуется live Studio contract test
ScriptDocument API и доступность из roblox-ts plugin context	Нужно проверить официальную reference и prototype
Package modified-state APIs	Не подтверждены

Asset-технические предложения.
Задача	Эффект	Усилие	Зависимости	Критерий приёмки	Ограничение
Local Asset Catalog v1	Агент сначала использует уже одобренные assets	M, 64–96 ч	manifest/provenance	Offline search по roles/style/bounds	Локальность
Asset role taxonomy	Связывает запрос «фонарь» с asset catalog	S, 24–40 ч	style profile	Versioned taxonomy, unknown roles permitted explicitly	Совместимость
asset_sanitize_plan/apply	Безопасная вставка чужих моделей	M, 64–96 ч	preflight	Hash покрывает hierarchy и policy; stale rejected	PlanHash
asset_fit_plan/apply	Scale/pivot/orientation/material normalization	M, 64–96 ч	semantic zones	Preview показывает before/after bounds	PlanHash
Asset candidate score	Ранжирует по style, fit, safety, reuse	S, 40–64 ч	catalog, style profile	Каждая score component возвращает evidence	Fail closed
assetPolicy в world plan	Делает reuse частью основного workflow	S, 24–40 ч	world planner	localOnly не вызывает сеть; external требует opt-in	Локальность
Package audit prototype	Находит потенциально stale/modified copies	M, 48–80 ч	API prototype	unknown не интерпретируется как up-to-date	Fail closed
Reimport reconciliation	Связывает Studio reimport и manifest	M, 64–96 ч	asset manifest	Source hash/settings/version сравнимы	Immutable plan
Draft-aware script editing	Защищает unsaved editor drafts	M, 64–96 ч	ScriptEditorService prototype	Stale Source никогда не перезаписывает draft молча	Fail closed
Optional Studio Skills adapter	Использует локальные native skills	M, 48–80 ч	separate package	Не добавляет dependency в core; invalid bundle fails	Core без deps
Целевая архитектура, ТЗ и дорожная карта

Целевая архитектура должна сохранить существующий bridge и добавить доменные orchestration-слои поверх него.

mermaid

flowchart TB
    A[MCP clients<br/>Claude Code / Codex / Cursor / Gemini]

    subgraph NODE[BloxForge Node process]
        REG[Stable tool registry<br/>profiles and lazy discovery]
        PIPE[Tool pipeline<br/>effects / auth / schemas / limits]
        ORCH[Domain orchestrators]
        WP[World Plan]
        AP[Asset Plan]
        RP[Review Plan]
        IDX[Semantic Scene Index]
        STORE[Local project state<br/>.bloxforge]
        ADAPT[Optional external adapters<br/>Open Cloud / Rojo / Wally]
    end

    subgraph STUDIO[Roblox Studio plugin]
        BR[Versioned bridge client]
        READ[Bounded extractors]
        MUT[Transactional handlers]
        VIS[Temporary review overlays]
        DASH[Authoring dashboard]
    end

    DM[Roblox DataModel]

    A --> REG
    REG --> PIPE
    PIPE --> ORCH
    ORCH --> WP
    ORCH --> AP
    ORCH --> RP
    WP --> IDX
    AP --> IDX
    RP --> IDX
    IDX <--> STORE
    ORCH --> ADAPT
    PIPE --> BR
    BR --> READ
    BR --> MUT
    BR --> VIS
    DASH --> BR
    READ --> DM
    MUT --> DM
    VIS --> DM

Архитектурные правила.
Правило	Требование
Bridge compatibility	Только optional request/response fields или новые endpoints; существующие shapes не меняются молча
Core dependencies	Scene index, plan hashing и row encoding реализуются на Node stdlib и существующем коде
State	Все project-local индексы находятся в .bloxforge/, имеют version и checksum
Recovery	Повреждённый индекс не читается как пустой; предлагается rebuild
Mutations	Любая массовая authoring-операция — plan/apply с полным planHash
Effects	Каждый tool объявляет Studio/files/process/network/upload/playtest effects
External calls	Default allowExternal=false; local catalog работает без сети
Temporary visualization	Overlay получает session ID и гарантированно очищается
Confidence	Любой inference возвращает evidence и confidence
Performance	Дорогие анализы bounded по region, instance count, time и resolution
Plugin code	Только TypeScript, совместимый с roblox-ts; handwritten Luau-модули не добавляются

Функциональное ТЗ World Authoring.

world_plan_create должен принимать:

ts

interface WorldPlanInput {
  goal: string;
  genre?: string;                 // не указано по умолчанию
  styleProfileId: string;
  targetRegion: Bounds;
  gameplayRequirements: {
    spawns?: number;
    routes?: number;
    checkpoints?: number;
    traversalProfiles?: string[];
  };
  assetPolicy: "localOnly" | "preferLibrary" | "balanced" | "primitiveOnly";
  externalSearchAllowed: boolean;
  seed: number;
  qualityTier: "prototype" | "standard" | "hero";
  deviceTier?: string;
}

Результат world_plan_create:

ts

interface WorldPlan {
  planId: string;
  planHash: string;
  assumptions: string[];
  blockedDecisions: string[];
  stages: Array<
    | BlockoutStage
    | SemanticZoneStage
    | AssetSearchStage
    | ModularPlacementStage
    | ScatterStage
    | LightingStage
    | ReviewStage
  >;
  expectedEffects: string[];
  estimatedInstanceDelta: number;
  externalCalls: ExternalCallDeclaration[];
}

world_plan_apply_stage применяет только один просмотренный stage. Это снижает риск огромной непрозрачной мутации и позволяет review между blockout, assets и dressing.

Modular Kit v1.

Новая сущность:

ts

interface ModularKit {
  version: 1;
  kitId: string;
  gridStuds: number;
  allowedRotations: number[];
  pieces: Array<{
    assetKey: string;
    role: "wall" | "corner" | "door" | "floor" | "ceiling" | "trim";
    footprint: [number, number, number];
    connectors: Connector[];
    pivotPolicy: string;
    styleTags: string[];
  }>;
}

modular_layout_plan:

    Принимает zone boundary и kit.
    Выравнивает границы на сетку.
    Подбирает pieces по connectors.
    Отдельно сообщает gaps и collisions.
    Не создаёт geometry при отсутствии корректного tile.
    Возвращает preview placements и planHash.

Scatter v1.

scatter_plan должен быть детерминированным по seed и включать:

    target surface/tag/region;
    asset pool;
    density;
    minimum spacing;
    slope range;
    altitude range;
    scale/yaw variation;
    exclusion volumes;
    maximum count;
    collision policy;
    hierarchy destination.

Apply обязан воспроизводить ровно preview placements. Любое изменение target geometry после preview должно инвалидировать hash.

Spline authoring.

Долгосрочный spline_layout_plan используется для дорог, рек, оград, кабелей и троп. В v1 spline можно представить control points и piece spacing без новой сторонней geometry-библиотеки. Mesh deformation и complex curve extrusion не входят в MVP.

Plugin dashboard.

Текущий connection UI сохраняется, но добавляются пять вкладок:
Вкладка	Содержимое
Plans	Pending plan, effects, diff, hash, apply/reject
Scene	Zones, routes, landmarks, index freshness
Assets	Candidates, thumbnails, provenance, scripts, fit
Review	Named screenshots, findings, before/after
Performance	Memory, instance/material counts, profiler summaries

Apply из UI не должен обходить MCP safety. Плагин отправляет то же подтверждение и тот же planHash, который потребовал бы MCP client.

Приоритеты и оценки.
Приоритет	Задача	Сложность	Оценка	Результат
MVP	Benchmark Places v1	S	40–64 ч + 3–5 дней tech art	Три контрольные карты
MVP	Local Agent Trace	S	32–48 ч	Измеримые trajectories
MVP	Docs truth table	S	16–24 ч	Устранён drift
MVP	Style Profile	S	48–72 ч	Явное художественное намерение
MVP	Semantic Scene Index	M	80–120 ч	Пространственная база
MVP	Review Set	S	40–64 ч	Стабильные ракурсы
MVP	Asset Catalog	M	64–96 ч	Offline reuse
MVP	Asset Sanitize	M	64–96 ч	Безопасная вставка
MVP	Asset Fit	M	64–96 ч	Нормализация
MVP	Draft-aware scripts	M	64–96 ч	Защита unsaved drafts
Среднесрочно	Route probes	M	80–120 ч	Достижимость зон
Среднесрочно	Scene quality audit v2	M	80–120 ч	Проверяемые finding
Среднесрочно	UI quality audit	M	48–80 ч	Device/accessibility checks
Среднесрочно	Modular Kit schema/layout	L	120–200 ч	Профессиональные environments
Среднесрочно	Scatter plans	M	80–120 ч	Dressing и foliage
Среднесрочно	World Plan orchestrator	L	120–200 ч	End-to-end map workflow
Среднесрочно	Plugin dashboard	L	120–200 ч	Human-in-the-loop UX
Долгосрочно	Room inference	M	80–120 ч	Indoor semantics
Долгосрочно	Spline layout	L	120–180 ч	Roads/rivers/fences
Долгосрочно	Biome/terrain recipes	L	160–240 ч	Масштабная генерация
Долгосрочно	Visual regression	M	80–120 ч	Golden screenshot gates
Долгосрочно	Real-Studio canary	L	100–180 ч	Проверка реального контракта
Долгосрочно	Optional Studio Skills adapter	M	48–80 ч	Native skill context

Таймлайн.

Оценка календаря предполагает одного full-time инженера. Технический художник, QA и дополнительный разработчик не указаны; при наличии второго инженера часть tracks можно выполнять параллельно, но Scene Index остаётся блокирующей зависимостью.
Период	Этап	Поставляемые результаты
Недели 1–2	Baseline	Benchmark places, trace format, docs fixes, метрики v1
Недели 3–5	Context and intent	Field replay, stable schemas, Style Profile, review camera recipes
Недели 6–9	Scene intelligence MVP	Scene Index, semantic zones, review set, composition evidence
Недели 10–13	Asset intelligence MVP	Local catalog, sanitize plan, fit plan, asset-first policy
Недели 14–17	Navigation and quality	Route probes, z-fighting/scale/density audit, UI audit
Недели 18–22	World authoring	Modular kit, scatter, staged World Plan
Недели 23–26	Product UX	Plugin dashboard, review workflow, tutorials
Месяцы 7–9	Professional QA	Visual regression, performance tiers, Studio canary
Месяцы 10–12	Advanced generation	Splines, rooms, biome recipes, package reconciliation

Рекомендуемые релизные границы.
Релиз	Содержание
v4.2	Trace/evals, docs truth, snapshot cursors, response experiments
v4.3	Style Profile, Scene Index v1, review set
v4.4	Local Asset Catalog, sanitize/fit, draft-awareness
v4.5	Route probes, scene/UI quality gates
v5.0	World Plan, Modular Kits, Scatter, plugin authoring dashboard
v5.1+	Splines, room inference, advanced terrain and visual regression

Нумерация релизов является предложением; фактическая release policy не указана.
Тестирование, CI/CD, документация, риски и приёмка

Целевой CI workflow.

mermaid

flowchart TB
    PR[Pull request] --> META[Protocol and metadata checks]
    META --> STATIC[Lint and Typecheck]
    STATIC --> UNIT[Unit and contract tests]
    UNIT --> PLUGIN[roblox-ts compile and Luau smoke]
    UNIT --> TRANSPORT[Fault injection and 10k benchmark]
    UNIT --> EVAL[Agent trajectory evals]
    PLUGIN --> INTEGRATION[Pinned Rojo/Rokit/Wally]
    TRANSPORT --> CROSS[Windows and macOS smoke]
    EVAL --> QUALITY[Scene and asset fixture gates]
    INTEGRATION --> REQUIRED[Required status]
    CROSS --> REQUIRED
    QUALITY --> REQUIRED

    NIGHTLY[Nightly] --> STUDIO[Windows Roblox Studio canary]
    NIGHTLY --> VISUAL[Golden review-set comparison]
    NIGHTLY --> PERF[Performance regression places]
    STUDIO --> REPORT[Canary report]
    VISUAL --> REPORT
    PERF --> REPORT

    REQUIRED --> REHEARSE[Release rehearsal]
    REPORT --> REHEARSE
    REHEARSE --> PUBLISH[npm publish with provenance]
    PUBLISH --> ASSETS[Upload validated Studio plugins]

Тестовая пирамида.
Уровень	Что проверяет	Частота
Pure unit	Hashing, compact formats, geometry helpers, scoring	Каждый PR
Schema/contract	Tool definitions, output schema, effects, argument names	Каждый PR
Protocol simulation	ACK, lease, retry, cancellation, stale response	Каждый PR
Compiled plugin smoke	Существование handlers и Luau patterns	Каждый PR
Lune helper runtime	Pure Luau utility behavior	Каждый PR
Pinned CLI integration	Rojo/Rokit/Wally semantics	PR/nightly
Benchmark place fixture	Scene index, assets, quality findings	Каждый PR без Studio, где возможно
Real Studio canary	Plugin↔Studio API contract	Nightly и release candidate
Visual regression	Named camera shots и overlays	Nightly
Human art review	Pairwise professional quality	Major milestone

Benchmark places.

Нужны минимум три version-controlled place/scene fixtures:
Fixture	Содержание	Проверки
small-obby	Простая трасса, checkpoints, UI	Reachability, scale, mobile UI
indoor-arena	Комнаты, двери, multiple routes, modular kit	Zones, room inference, landmarks
outdoor-village	Terrain, foliage, props, packages, PBR	Scatter, asset reuse, streaming/performance

Для каждого fixture хранятся:

text

semantic ground truth
expected route matrix
expected quality findings
approved asset manifest
named camera recipes
golden screenshots
device matrix
performance baseline

Метрики качества продукта.
Категория	Метрика	Целевой gate
Агент	Task success rate	Не ниже baseline; MVP +10 п.п. на map tasks
Агент	Wrong-tool calls/task	−25% от baseline
Агент	Tool round-trips/task	−20% на asset-placement tasks
Контекст	Tool-result tokens/task	−20% без падения success
Контекст	Drill-down success	≥95% на benchmark lookup
Assets	Approved asset reuse ratio	≥60% non-hero props в benchmark
Assets	Unsafe scripts inserted	0
Assets	Unknown provenance in release fixture	0 либо explicit waiver
Scene	Tagged zone reachability	100% обязательных маршрутов
Scene	Unresolved error findings	0 перед stable release
Visual	Human pairwise preference	Новая версия не хуже baseline
UI	Critical contrast/overflow errors	0 на target device matrix
Transport	Duplicate mutation execution	0
Transport	Pending request leak	0
Performance	p95 scene-index build	Бюджет устанавливается после baseline
Release	Real-Studio canary	Pass на поддерживаемой Studio version

Числа +10 п.п., −25%, −20%, 60% являются плановыми целями, а не измеренными текущими значениями.

Документация.
Документ	Изменение
docs/architecture.md	Обновить количество tools, Wally behavior, Scene Index и World Plan
docs/compatibility.md	Матрица server/plugin/protocol/Studio/Node/Rojo/Rokit/Wally
docs/asset-pipeline.md	Catalog → preflight → sanitize → fit → package → reimport
docs/world-authoring.md	Style Profile, zones, modular kits, scatter, staged apply
docs/quality-rules.md	Полный список deterministic checks и false-positive policy
docs/evals.md	Fixtures, task definitions, model/client matrix, metrics
examples/	Три законченных benchmark workflows
docs/release-acceptance.md	Автоматический и ручной чек-лист
ADR	Каждое изменение bridge/protocol/state format

Для внешних toolchain-утверждений в документации следует ввести машинно проверяемую таблицу:

yaml

claim:
  id: rojo-sourcemap-non-scripts
  tool: rojo
  version: 7.7.0
  source: official-release-or-source-tag
  executableTest: tests/...
  lastVerified: 2026-08-05

Это напрямую снижает риск повторения уже отмеченных ошибок с Rojo и Wally.

Основные риски.
Риск	Вероятность	Влияние	Митигация
Roblox Studio API меняется без синхронного CI	Высокая	Высокое	Nightly real-Studio canary
«Beauty score» оптимизируется формально, но ухудшает карту	Высокая	Высокое	Набор независимых метрик + human pairwise
Scene Index тормозит большие places	Средняя	Высокое	Region bounds, incremental digest, time budget
Asset metadata неполны	Высокая	Среднее	Authoritative isolated load, unknown states
Чужой asset содержит executable content	Средняя	Высокое	Sanitize plan, default deny
Plugin UI разрастается и дублирует Node logic	Средняя	Среднее	UI только отображает/подтверждает server-owned plans
Dynamic schemas ухудшают cache	Средняя	Среднее	Stable profiles/order/revisions и client-specific eval
TS 5.5 plugin и TS 6 core расходятся	Средняя	Среднее	Dual-version compatibility tests
Internal Assistant.rbxm меняется	Высокая	Низкое/среднее	Optional experimental adapter, fail closed
Roadmap слишком велик для одного разработчика	Высокая	Высокое	Release slicing, не начинать biome/splines до MVP metrics
Внешние API нарушают local-first	Средняя	Высокое	allowExternal=false default, declared effects
Plan применён к изменившейся сцене	Средняя	Высокое	Scene/asset digests внутри planHash

Критерии приёмки MVP.

    Все новые read-инструменты работают полностью offline, кроме явно объявленных optional asset searches.
    Ни один новый runtime dependency не добавлен в packages/core.
    Существующие bridge request/response shapes не изменены несовместимо.
    Каждый новый tool содержит явные effects.
    Каждый authoring apply требует planHash, покрывающий input, scene digest, asset policy, seed и placements.
    Повреждённый Scene Index, Style Profile или Asset Catalog завершает операцию ошибкой.
    Три benchmark fixtures имеют semantic ground truth.
    Style Profile способен описать palette, material roles, grid, density и lighting intent.
    Scene Index возвращает явные и inferred zones отдельно.
    Review Set воспроизводит одинаковые именованные camera recipes.
    Asset Sanitize не позволяет executable content попасть в place без явной review policy.
    Asset Fit показывает preview bounds и pivot до apply.
    Unsaved ScriptDocument draft не перезаписывается молча.
    Agent task success не падает относительно v4.1.0 baseline.
    Средний result-token cost на benchmark map tasks снижен минимум на 15%.
    Все existing 961 tests продолжают проходить; новое точное количество станет известно после реализации.
    Документация не содержит непроверенных заявлений о внешних CLI без source/version/test metadata.

Чек-лист pull request.

    Tool definition и handler добавлены вместе.
    Effects перечислены явно.
    Input validation отклоняет unknown keys, где это state-changing plan.
    Output schema соответствует runtime output.
    Большой read имеет limit/cursor/fields либо обоснование отсутствия.
    Mutation имеет undo или документированное исключение.
    Plan hash покрывает все факторы apply.
    Error содержит точное имя параметра и recovery hint.
    Bridge change совместим со старым plugin protocol либо повышает minimum protocol явно.
    Unit, contract и fixture tests добавлены.
    Generated documentation обновлена.
    Внешнее tool/API behavior подтверждено официальным source/tag/reference.
    Новая dependency в core отсутствует либо приложено отдельное архитектурное решение.

Чек-лист release candidate.

    npm run release:check:full проходит.
    Node 20/22, Windows и macOS jobs проходят.
    Pinned Rojo/Rokit/Wally integrations проходят.
    Release rehearsal устанавливает оба tarball в чистую директорию.
    Full и Inspector plugin variants устанавливаются атомарно.
    Server/plugin protocol matrix проверена.
    Upgrade с предыдущей stable version проверен.
    Все benchmark places проходят semantic и asset gates.
    Nightly Windows Studio canary прошёл на текущей поддерживаемой Studio version.
    Camera review set не содержит необъяснённого visual regression.
    Performance baseline не ухудшился сверх утверждённого tolerance.
    Все imported assets имеют provenance или explicit waiver.
    Все executable contents внешних assets прошли review.
    Нет unresolved critical/high scene findings.
    Changelog содержит migration notes и known limitations.
    Документация и actual tool catalog совпадают.
    GitHub Release tag, npm version, plugin metadata и package version совпадают.
    Rollback-процедура плагина проверена.
    Никакие secrets, cookies, local paths или place payloads не присутствуют в artifacts.

Итоговый приоритет.
Порядок	Инициатива	Обоснование
1	Benchmark places + trajectory telemetry	Без этого любые token/beauty улучшения будут мнением
2	Draft-awareness и Studio contract regressions	Защита пользовательских данных важнее новых генераторов
3	Style Profile	Создаёт формальный источник художественного намерения
4	Semantic Scene Index	Общая зависимость navigation, composition, assets и QA
5	Review Set	Даёт стабильную visual feedback loop
6	Local Asset Catalog + Sanitize + Fit	Переводит готовые assets из optional tools в рабочий pipeline
7	Route и scene quality audits	Делает карту не только красивой, но и играбельной
8	World Plan orchestrator	Связывает существующие 213 tools в целостный процесс
9	Modular Kits и Scatter	Наибольший непосредственный прирост профессионального вида
10	Plugin authoring dashboard	Делает планы и review доступными человеку
11	Real-Studio canary	Требуется до объявления workflow production-grade
12	Splines, rooms и biomes	Высокая ценность, но только после стабилизации основы
13	Upstream Studio Skills adapter	Интересная дополнительная возможность, но не критическая для качества карт

Главное решение для следующего major-релиза: не увеличивать число независимых команд, а превратить BloxForge в систему планирования и проверки художественного production pipeline. Профессиональная карта должна появляться не из одного длинного generated-Luau вызова, а из последовательности проверяемых стадий с явным style brief, semantic zones, approved assets, детерминированными placements, визуальным review и техническими release gates.
