---
type: roadmap-research-input
part: 1
date: 2026-08-04
source: ChatGPT deep research (external, unverified — treat claims about repo state as hypotheses to check, not fact)
language: ru
status: raw — not yet reviewed, not a decision, not ROADMAP.md itself
---

# Roadmap research — part 1

**What this file is:** raw output from a ChatGPT "deep research" pass on the BloxForge repo,
kept as input material for building `ROADMAP.md`. It is not the roadmap, not reviewed, and not
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

---

Дорожная карта развития BloxForge для профессиональной интеграции с Roblox Studio
Резюме для руководителя

BloxForge уже представляет собой технически развитый MCP-шлюз к Roblox Studio, а не ранний прототип. Проект объединяет Node.js/TypeScript-сервер, Studio-плагин, более сотни инструментов, профиль только для чтения, управление Rojo/Rokit/Wally, запуск playtest-сессий, диагностику, журналирование запросов и защитные механизмы plan/apply. Архитектура использует MCP через stdio, локальный мост к Studio, WebSocket с резервным long polling, идентификаторы запросов, аренды доставки, дедупликацию и централизованные capability-политики.

Главный вывод исследования: сильнейшая сторона BloxForge — безопасная автоматизация и управление состоянием Studio; слабейшая — художественный, модельный и пространственный workflow создания профессиональных карт. В репозитории уже есть генераторы Terrain, пресеты Lighting, инструменты UI-дизайна, Marketplace/Open Cloud, снимок мира и операции с объектами, но они пока больше подходят для агентной сборки функционального прототипа, чем для систематического создания визуально целостного окружения с модульными китами, PBR-материалами, вариантами моделей, управляемым рассеиванием, контролем композиции и измеримыми бюджетами производительности.

Поэтому рекомендуемая стратегия — не расширять бесконечно количество низкоуровневых MCP-команд, а сформировать поверх существующего ядра три продуктовых слоя:

    Детерминированный asset pipeline: манифесты, происхождение, версия, права, безопасная загрузка, PBR-проверки, package/reimport и воспроизводимость между компьютерами.
    Semantic World Authoring: модульные киты, зоны, сплайны, scatter, style recipes, композиционные правила и редактируемые генеративные планы.
    Visual & Performance QA: автоматические ракурсы, screenshot diff, проверки материалов и освещения, целевые устройства, streaming-аудит и бюджеты сцены.

Первые задачи должны быть направлены на стабильность реального Studio-контракта. В CHANGELOG.md зафиксированы недавно обнаруженные серьёзные дефекты: playtest-эпизоды могли не получать логи, runtime-ошибки могли не проваливать проверку, операции создания могли молча игнорировать свойства, smart_duplicate мог не применять вариации, world snapshot учитывал внутренние объекты Studio, а некоторые Luau-ответы были дважды сериализованы. Прозрачность changelog и dogfooding — сильная сторона, но концентрация таких ошибок показывает необходимость реального Studio contract-testing, а не только модульных тестов и проверки скомпилированного Luau.

Предлагаемый горизонт — четыре макро-спринта продолжительностью от трёх до шести месяцев, всего восемнадцать месяцев. Оценка предполагает команду, размер которой в запросе не указан: примерно три full-time инженера, технический художник на половину ставки и регулярная QA-поддержка. Для одного разработчика сроки следует умножать приблизительно на 2,5–3,5.

К концу программы BloxForge должен позволять не просто выполнить запрос «создай карту», а воспроизводимо провести процесс:

референс и style brief → blockout → модульный kit → импорт и проверка моделей → материалы → scatter и dressing → lighting → playtest → visual/performance gate → package/version release.

Исследование основано на публичном состоянии репозитория main, видимых GitHub-метаданных и публичной документации. Репозиторий публичный; на странице GitHub на момент проверки отображались 170 коммитов, ноль открытых Issues и ноль Pull Requests. Нулевое число публичных Issues нельзя интерпретировать как отсутствие дефектов, особенно с учётом активного changelog. Частные Issues, закрытые внутренние трекеры, branch protection, GitHub Actions secrets, npm-аналитика, Roblox-аккаунты, приватные модели и реальные права на ассеты в рамках этого исследования недоступны и не проверялись.
Аудит текущего состояния репозитория

BloxForge организован как TypeScript-монорепозиторий с npm workspaces. Корневой package.json объединяет core, основной MCP-сервер и read-only inspector; отдельно находится studio-plugin, собираемый из TypeScript в Luau, а также evals, tests, scripts, документация и статические assets. Проект требует Node.js 20+, использует строгую типизацию и содержит раздельные команды для сборки, lint, typecheck, тестов, документации, плагина, интеграции Rojo и release verification.
Область	Текущее состояние	Сильные стороны	Риск или пробел	Рекомендуемое действие
Структура	packages/core, два MCP-пакета, studio-plugin, evals, tests, docs, scripts, assets	Хорошее разделение server/core/plugin и наличие read-only варианта	core объединяет transport, builders, asset logic, Rojo, quality и orchestration; дальнейший рост повысит связанность	Разделить core на домены protocol, studio-bridge, world-authoring, asset-pipeline, qa, сохранив публичный facade
Архитектура моста	MCP stdio → Node server → localhost bridge → Studio plugin; WebSocket и fallback polling	ACK, lease, deduplication, journal, outcome_unknown, auth и backpressure уже предусмотрены	Сложность транспортного автомата велика; регрессии трудно обнаруживать без настоящего Studio	Ввести versioned conformance suite между server/plugin и Windows Studio canary
Типизация	strict: true, ES2022, declarations и source maps	Сильная базовая дисциплина	skipLibCheck: true; значительная часть поведения генерируется строками Luau и находится вне TS type system	Добавить typed Luau IR/AST или шаблонный DSL, schema-first кодогенерацию и golden tests
Тесты	Jest, fault injection, plugin smoke, Lune runtime smoke, Rojo и toolchain integration	Редко встречающийся для community-проекта уровень transport-тестирования	Coverage собирается, но обязательный порог не установлен; нет visual regression и полноценной Studio-матрицы	Установить дифференциальные coverage gates и добавить asset/visual/Studio suites
CI	Linux Node 20/22, Windows/macOS smoke, pinned Rojo/Rokit, checksums, nightly toolchain	Хорошая supply-chain гигиена, pinning actions по commit SHA, кроссплатформенные проверки	Cross-platform smoke не равен работе внутри актуального Roblox Studio; нет performance regression map	Добавить ограниченный Windows Studio canary и набор benchmark places
Документация	README, Architecture, Known Limitations, Troubleshooting, Security, generated tool reference, changelog	Документация объясняет не только команды, но и safety model	Есть признаки drift: CONTRIBUTING.md ссылается на отсутствующий todo.md; Known Limitations утверждает отсутствие общего orchestration tool, хотя project_reconcile_* уже добавлен	Docs link-check, executable tutorials, ADR и автоматическая проверка утверждений о tool availability
Плагин	DockWidget с состоянием соединения, URL, вкладками и диагностикой	Практичная связь с несколькими server instances	Интерфейс ориентирован почти только на соединение, а UI.ts вручную создаёт большое дерево Instances	Превратить плагин в authoring dashboard: Plans, Assets, Scene, Style, Performance, Review
Assets и модели	Marketplace/Open Cloud clients, preflight, insert outcome, provenance-related tools	Существующая точка расширения и обработка permission failures	Нет очевидного целостного DCC→manifest→validate→upload→package→place workflow; provenance не является обязательным контрактом каждого экземпляра	Ввести Asset Manifest, quarantine, package pinning, PBR validator и reimport mapping
Terrain	Baseplate, island, noise mountains, water, paint/clear	Безопасные volume helpers и нативная работа через Terrain API	Генерация примитивная: нет biome graph, masks, erosion, spline rivers/roads, chunked preview	Перейти к non-destructive terrain recipes и staged preview
Lighting	Набор hand-tuned пресетов, Atmosphere, Sky, Bloom, ColorCorrection, SunRays	Быстрый старт и идемпотентное создание эффектов	Фиксированные значения без художественного brief, camera exposure tests, device tiers и budget lint	Lighting rigs, LUT-like profiles, shot matrix и adaptive quality policy
UI-дизайн	Tokens, themes, component catalog, design lint и screenshot review	Хороший пример того, как канонизировать дизайн вместо ad hoc генерации	Система относится преимущественно к 2D GUI; аналогичного 3D style system нет	Перенести подход tokens/catalog/lint на материалы, модульные киты, scale и detail density
World understanding	Token-efficient world snapshot, class counts, roots, environment summary	Верное направление: сначала компактный snapshot, потом drill-down	Не хватает spatial graph, zones, visibility, composition, duplicate meshes/materials, asset provenance	Создать semantic scene index и spatial/material/performance layers
Примеры	README содержит команды запуска и два prompt-сценария	Низкий порог первого запуска	В осмотренной структуре не обнаружен полноценный reference place, visual gallery или golden asset corpus	Добавить examples/ с тремя жанрами и зафиксированными результатами
Известные проблемы	Публичный issue backlog пуст, но changelog фиксирует критические dogfooding-регрессии	Быстрое исправление и подробный разбор причин	Текущая метрика «0 Issues» не отражает внутреннюю стабильность	Публичные labels/milestones, Known Issues board, regression ID для каждого changelog fix
Оценка качества кода

Техническое качество выше среднего для открытого Roblox-инструментария: strict TypeScript, разделённые эффекты, immutable plan hashes, атомарная установка плагина, явная обработка неизвестного результата мутации, проверка package metadata и real-CLI integration свидетельствуют о серьёзном инженерном подходе.

При этом значительная часть Studio-функциональности реализована как генерация Luau-строк из TypeScript. Это позволяет быстро добавлять инструменты без пересборки плагина, но создаёт отдельный неявный язык внутри проекта: TypeScript-компилятор не проверяет имена Roblox-свойств, структуру возвращаемых таблиц, области переменных и часть control flow. Именно на границе TS → JSON → Luau → plugin envelope возникали некоторые недавние ошибки сериализации и типов.

Рекомендуемый рефакторинг — не отказаться от генерации Luau, а ввести промежуточный слой:

text

Typed Tool Input
      ↓
Domain Plan / Scene IR
      ↓
Validated Luau AST or constrained emitter
      ↓
Plugin execution
      ↓
Versioned result schema

Каждый generated-Luau tool должен иметь один и тот же контракт: schema validation, cancellation checkpoint, transaction/undo scope, structured return, bounded output и нормализацию ошибок. Сейчас эти свойства существуют, но исторически применялись неравномерно, что видно по changelog.
Документация и примеры

README хорошо объясняет роли BloxForge, Rojo, Rokit и Wally, профили инструментов, локальную модель безопасности и plan/apply. В нём также явно зафиксировано, что локальные файлы являются источником истины для Rojo-проектов, а Studio bridge отвечает за инспекцию, playtest и объекты вне управляемых Rojo roots.

Следующий шаг — превратить документацию из справочника команд в обучающий product journey:
Необходимый пример	Что должен демонстрировать	Автоматическая проверка
examples/stylized-village	Modular kit, scatter, terrain, day/night, packages	Screenshot golden, mobile budget
examples/interior-shop	Grid snapping, trim sheets, props, lighting composition	Asset provenance и overlap lint
examples/open-world-biome	Streaming zones, biome masks, LOD, roads	Join time, memory, streaming coverage
examples/ui-driven-obby	Существующие GUI/design tools плюс 3D style tokens	Device matrix, gamepad and visual test
examples/asset-library	FBX/glTF → PBR → package → update	Hash/version/reimport reproducibility
Целевая интеграционная архитектура

Roblox Studio уже предоставляет несколько разных asset-механизмов, и BloxForge не должен пытаться заменить их одним собственным форматом. Studio Importer поддерживает .fbx, .obj и .gltf; FBX и glTF могут содержать иерархии, PBR-текстуры, rigs, анимации и vertex colors. Importer также поддерживает очереди, presets, загрузку в Roblox и импорт как Package.

Roblox Packages предназначены для повторного использования иерархий объектов, совместной работы, версионирования, сравнения и восстановления версий. Roblox отдельно рекомендует package workflow, позволяющий начать с graybox-модели и впоследствии обновить все копии финальным ассетом.

Open Cloud Assets позволяет создавать и обновлять cloud assets через API, но часть соответствующих endpoints помечена Beta, поэтому BloxForge должен изолировать API-version changes за adapter layer и не делать beta endpoint единственным путём импорта.
Сравнение вариантов asset pipeline
Механизм	Источник истины	Преимущества	Ограничения	Роль BloxForge
Studio Importer	Локальный FBX/glTF/OBJ и настройки Studio	Preview, warnings, PBR, hierarchy, rigs, import presets	Часть действий интерактивна; результат зависит от локальных настроек	Подготовить manifest, preflight и post-import verification; открывать guided workflow
Native Reimport	Локальная привязка Studio к исходному 3D-файлу	Неразрушающее обновление MeshPart/SurfaceAppearance, сохранение Roblox-specific properties	Пути хранятся локально и могут различаться у участников команды	Хранить portable logical source ID и проверять локальную mapping-конфигурацию
Roblox Package	Опубликованная версия package asset	Версии, diff, rollback, permissions, auto-update	Modified copy перестаёт автоматически обновляться; ownership требует решения заранее	Package catalog, pin policy, update plan, modified-copy detector
Open Cloud Assets	Репозиторий + cloud asset ID/version	Автоматизация upload/update и CI	Credentials, moderation, API beta surfaces	Credential-scoped adapter, async status polling, audit log
Rojo + RBXM/RBXMX	Файлы репозитория и project mapping	Git, code review, воспроизводимость, mixed filesystem/Studio workflow	Не все Studio данные удобно выражаются как исходные файлы; reverse sync ограничен	Оставить Rojo authority и добавить manifest links для art assets
Creator Store / AssetService	Cloud asset ID	Быстрое повторное использование community models	Права, качество, malicious scripts, непредсказуемые зависимости	Search → quarantine → sandbox → audit → explicit approval
InsertService	Cloud asset ID	Уже используется существующими потоками	Более строгие ownership checks; free third-party assets требуют другого пути	Сохранить как compatibility adapter, но для новых flows предпочесть AssetService

Текущий assets.ts справедливо учитывает, что InsertService:LoadAsset() может отклонять модель из-за ownership/copy restrictions. Однако официальная документация указывает, что для публичных бесплатных ассетов может использоваться AssetService:LoadAssetAsync() при включённом AllowInsertFreeAssets; загруженная модель по умолчанию sandboxed и не получает script capabilities. Это делает AssetService более подходящей базой для безопасного режима «найти и проверить», чем немедленная вставка через InsertService.
Предлагаемый Asset Manifest

В корне проекта следует добавить bloxforge.assets.json или bloxforge.assets.toml. Для каждого логического ассета он должен хранить:

json

{
  "assetKey": "environment/tree/pine_a",
  "source": {
    "path": "art/environment/trees/pine_a.glb",
    "sha256": "…",
    "dcc": "Blender",
    "unitScale": 1.0,
    "forwardAxis": "-Z",
    "upAxis": "Y"
  },
  "import": {
    "preset": "environment-static",
    "pivotPolicy": "base-center",
    "collision": "hull",
    "renderFidelity": "automatic",
    "package": true
  },
  "materials": {
    "colorMap": "pine_a_color.png",
    "normalMap": "pine_a_normal.png",
    "roughnessMap": "pine_a_roughness.png",
    "metalnessMap": null
  },
  "roblox": {
    "ownerType": "group",
    "ownerId": 123,
    "assetId": 456,
    "assetVersion": 7,
    "packageId": 789
  },
  "policy": {
    "scriptsAllowed": false,
    "license": "project-owned",
    "maxTriangles": 18000,
    "maxTextureSize": 2048
  }
}

Манифест должен быть декларативным: BloxForge сравнивает желаемое и фактическое состояние, формирует immutable plan и только после подтверждения выполняет upload, package update или замену экземпляров. Этот подход соответствует уже существующей в BloxForge модели planHash и не вводит вторую, менее безопасную парадигму.
Рекомендуемый поток ассетов

ошибка

готово

не соответствует

соответствует

fail

pass

Blender / Maya / Substance / локальные текстуры

Asset Manifest

Local Preflight

Формат и hash

Scale, axes, bounds, pivot

Triangles, UV, PBR maps

License and ownership policy

Отчёт и исправление в DCC

Путь импорта

Studio Importer / Reimport

Open Cloud upload

Existing Package or Asset ID

Creator Store quarantine

Post-import Studio audit

Sandbox and script quarantine

Hierarchy and naming

Pivot and scale

Materials and SurfaceAppearance

Collision and render settings

Provenance attributes

Repair plan

Convert or update Package

Place instances pinned to version

Visual and performance QA

Release artifact and changelog

Форматы и versioning

Для Git-friendly content следует продолжить использовать Rojo project files, Luau и небольшие .rbxmx; бинарные .rbxm/.rbxl допустимы для Terrain, сложных сцен и эталонных fixtures, но должны сопровождаться машинно-читаемым metadata summary. Rojo project format позволяет описывать Instance tree, filesystem paths, свойства и ограничения live sync; BloxForge уже правильно оставляет интерпретацию проекта самому Rojo CLI.

Версионирование должно разделять:
Версия	Что идентифицирует	Пример
Source revision	Конкретное состояние DCC-файла	SHA-256 GLB/FBX
Import recipe version	Настройки осей, scale, collision, PBR	environment-static@2
Roblox asset version	Cloud-версия mesh/image/model	assetId:version
Package version	Иерархия готового prefab	Package version
Scene recipe version	Размещение и вариации	forest-zone@5
BloxForge tool version	Генератор и schema	npm/package semver

Такое разделение позволяет ответить на вопрос не только «какой asset ID стоит в сцене», но и «из какого исходника, какими настройками и какой версией BloxForge он получен».
Продуктовый UX для создания профессиональных карт

Плагин должен эволюционировать из панели соединения в selection-aware authoring workspace, сохраняя возможность полностью агентного использования. Профессиональный художник должен видеть план изменений, превью, нарушения стиля и performance budget до того, как агент применит изменения.

Рекомендуемые режимы панели:
Режим	Основные действия	Что видит пользователь
Inspect	Снимок сцены, поиск, зависимости	Зоны, классы, asset provenance, warnings
Blockout	Объёмы, размеры, маршруты, spawn и gameplay spaces	Сетка, metrics, проходы, sight lines
Kit	Prefabs, variants, snap points, sockets	Каталог модулей с thumbnails и package versions
Scatter	Растительность, мусор, камни, декор	Seed, density mask, slope/height filters, exclusions
Terrain	Biomes, roads, rivers, erosion-like filters	Non-destructive layer stack и preview chunks
Materials	MaterialVariant, SurfaceAppearance, palettes	PBR completeness, texel density, duplicate maps
Lighting	Time, atmosphere, local lights, post FX	Shot matrix для low/medium/high quality
Optimize	Streaming, triangles, draw pressure, lights, particles	Бюджеты по зонам и целевым устройствам
Review	Before/after, comments, acceptance gate	Screenshot diff и список нарушений
Композиция и blockout

BloxForge должен поддерживать scene brief, который агент превращает не сразу в Instances, а в проверяемую структуру:

yaml

style: stylized-cozy
playerScale: standard-r15
primaryRoute:
  widthMin: 12
  landmarkEvery: 120
zones:
  - id: spawn
    purpose: onboarding
    sightlineTarget: windmill
  - id: market
    purpose: social-hub
    density: high
palette:
  dominant: warm-stone
  accent: teal-painted-wood

Из brief формируется blockout с зонами, primary/secondary paths, landmark anchors, playable bounds и camera shots. После утверждения blockout заменяется модульными пакетами, но логические IDs и привязки остаются. Это позволяет обновлять стиль без разрушения gameplay-семантики.
Модульные киты и модели

Каждая модель, используемая как строительный модуль, должна иметь стандартизированные metadata:

    BF_AssetKey, BF_SourceHash, BF_PackageVersion;
    pivot policy и bounding box;
    snap sockets через Attachments или tagged helper nodes;
    допустимые повороты и scale range;
    collision preset;
    список material slots;
    variant family;
    LOD/performance class;
    разрешение или запрет embedded scripts.

Roblox Packages особенно подходят для kit-based environments, поскольку поддерживают повторное использование, version history, сравнение, rollback и обновление нескольких копий. Официальная документация также предупреждает, что чужие модели могут содержать вредоносные scripts, поэтому BloxForge должен помещать внешние модели в quarantine до их использования.

Для placement UX следует взять за ориентир простоту F3X, точные операции ResizeAlign/GapFill и детерминированное клонирование BrushTool. Creator Store показывает Building Tools by F3X, Archimedes, Stravant ResizeAlign/GapFill и Brushtool среди наиболее заметных building plugins; Brushtool специализируется на кистевом размещении копий Parts/Models и поддерживает пользовательские объекты.

BloxForge не должен буквально копировать интерфейсы этих плагинов. Следует заимствовать принципы:

    минимальное число параметров в основном режиме;
    манипуляторы непосредственно в viewport;
    повторяемые операции с явным seed;
    быстрый Undo одной пользовательской операцией;
    preview до commit;
    возможность повторно открыть и изменить параметры уже применённой операции.

Материалы и PBR

Нужны два разных workflow:
Workflow	Когда применять	Проверки
MaterialVariant	Повторяемые tileable поверхности: камень, грунт, штукатурка, металл	naming, scale, reuse, material palette
SurfaceAppearance	Уникальный UV-mapped MeshPart	Color/Normal/Roughness/Metalness, UV, alpha mode, texture size

SurfaceAppearance предназначен для расширенного внешнего вида MeshPart и поддерживает Color, Metalness, Normal, Roughness и emissive-related content. Roblox допускает текстуры до 4096×4096, но максимальное разрешение не должно становиться значением по умолчанию; BloxForge должен задавать бюджеты по asset class и целевому устройству.

Следует добавить:

    PBR map detector: распознавание _color, _normal, _roughness, _metalness, _emissive.
    Channel validator: grayscale expectations, normal orientation, missing maps, alpha misuse.
    Texel-density audit: поиск объектов с несопоставимой плотностью текстур.
    Duplicate-content detection: одинаковые изображения с разными asset IDs.
    Material palette: ограниченный набор разрешённых материалов на biome/style.
    One-click repair plan: переиспользовать существующую карту, уменьшить разрешение, заменить SurfaceAppearance на MaterialVariant.

Освещение

Существующие пресеты полезны как демонстрация, но профессиональный workflow должен разделить:

    art direction: цвет, контраст, время суток, туман, silhouette;
    exposure: читаемость ключевых зон;
    local lighting: количество и радиусы источников;
    quality policy: что выключается на low-end;
    camera validation: как сцена выглядит с реальных игровых ракурсов.

Roblox Lighting управляет глобальным освещением, атмосферой и post-processing, поэтому BloxForge должен оценивать их совместно, а не как независимые свойства.

Предлагается формат lighting.profile.json:

json

{
  "name": "cozy-evening",
  "shots": ["spawn", "market", "interior-shop"],
  "global": {
    "clockTime": 18.2,
    "brightness": 1.7,
    "exposureCompensation": 0.15
  },
  "quality": {
    "low": { "bloom": false, "shadowLightsMax": 4 },
    "medium": { "bloom": true, "shadowLightsMax": 10 },
    "high": { "bloom": true, "shadowLightsMax": 20 }
  },
  "readability": {
    "minSubjectBackgroundContrast": 0.18,
    "spawnMustBeVisible": true
  }
}

Производительность как часть дизайна

Roblox рекомендует выбирать baseline low-end device, тестировать память и frame rate на нём в течение разработки, использовать Instance Streaming для больших мест и переиспользовать meshes/textures вместо создания дубликатов. В официальной документации приводятся draw/triangle counts как пример эмпирического бюджета, но конкретный предел должен определяться измерениями конкретной игры, а не восприниматься как универсальная гарантия.

Поэтому BloxForge должен поддерживать budgets-as-code:

toml

[target.mobile_low]
fps_p50 = 30
memory_mb_max = 900
streaming_enabled = true

[zone.market]
instances_max = 12000
mesh_triangles_visible_max = 650000
unique_textures_max = 140
shadow_lights_max = 8
particles_emit_rate_max = 2500
transparent_layers_max = 4

Проверки должны выполняться как в edit snapshot, так и во время playtest. Edit-анализ выявляет структуру и потенциальные нарушения, а runtime подтверждает реальные memory/frame/render показатели.
Приоритизированный бэклог

Оценки S/M/L являются инженерными, а не календарными: S — до двух engineer-weeks, M — три–шесть, L — семь–двенадцать. Задачи большего размера намеренно разбиты. Модерация Roblox, получение прав на ассеты и время работы художника в оценку не входят.
Функция	Приоритет	Усилие	Зависимости	Критерии приёмки
Реальный Studio protocol conformance suite	High	L	Windows runner, test place, plugin installer	На supported Studio channel проходят connect/read/mutate/undo/playtest/disconnect; результат публикуется как artifact
Version handshake server↔plugin↔schema	High	S	Protocol manifest	Несовместимые версии fail closed с точной инструкцией; совместимые minor versions проходят contract tests
Единая mutation transaction wrapper	High	M	ChangeHistoryService, safety manager	Каждая edit-mode мутация либо создаёт одну корректную Undo-запись, либо полностью отменяется
Typed generated-Luau IR	High	L	Result schemas, builders	Новые builders не формируют произвольные envelopes; property names и return shape проверяются до отправки
Asset Manifest v1	High	M	Project root, TOML/JSON parser	Asset можно однозначно восстановить по source hash, recipe и Roblox version
Model quarantine и script audit	High	M	AssetService adapter, capability policy	Внешняя модель не попадает в рабочую сцену до отчёта; scripts disabled/sandboxed по умолчанию
AssetService loading adapter	High	M	Studio settings detection	Owned/shared/free assets корректно различаются; permission error предлагает рабочий путь, но не обход
Package catalog и pinning	High	L	Open Cloud/Studio package metadata	BloxForge показывает outdated/modified copies, планирует update и не перезаписывает modified copy без подтверждения
PBR preflight и map binding	High	L	Asset Manifest, image metadata	Для corpus моделей правильно определяются карты; отсутствующие/невалидные карты блокируют publish policy
Pivot, bounds, scale и axes validator	High	M	Mesh metadata/import hooks	Импорт с неверным scale/axis получает точную диагностику; auto-repair создаёт preview
Visual snapshot matrix	High	L	Screenshot tools, named cameras	Один вызов создаёт фиксированные кадры по quality/device/time profiles и manifest результатов
Perceptual screenshot diff	High	M	Snapshot matrix, baseline storage	CI различает допустимое антиалиасинговое расхождение и значимую визуальную регрессию
Performance budget linter	High	L	World snapshot, playtest telemetry	Отчёт содержит zone, metric, budget, measured value и offending instances
Authoring Dashboard в plugin	High	L	Plugin UI component refactor	Панели Plans/Assets/Scene/Review работают без MCP-клиента и синхронны с агентом
Modular Kit schema и catalog	High	L	Asset Manifest, packages	Kit содержит sockets, variants, allowed rotations, preview; replacement сохраняет logical IDs
Deterministic scatter tool	High	L	Kit catalog, spatial queries	Одинаковые input+seed дают одинаковое размещение; поддерживаются slope, height, collision и exclusion zones
3D style tokens и style lint	High	M	Materials, scene index	Проверяются palette, scale language, material count, detail density и naming
Semantic scene graph	Medium	L	World snapshot v2, tags/attributes	Возвращаются zones, routes, landmarks, kit instances, dependencies и spatial relationships
Spline roads/walls/fences	Medium	L	Modular Kit, viewport preview	Editable control points; пересборка сохраняет ручные разрешённые overrides
Terrain layer stack	Medium	L	Terrain builders, serialization	Biome/mask/road/water layers можно preview, reorder, regenerate и удалить независимо
Biome scatter recipes	Medium	M	Terrain layers, scatter	Один biome recipe размещает ground cover, rocks и trees по детерминированным masks
Reimport mapping across machines	Medium	M	Asset Manifest, native reimport metadata	Сотрудник может связать logical source с локальным path без записи абсолютного пути в place
Collision/RenderFidelity policy	Medium	M	Asset classes, performance budgets	Каждая модель получает policy; исключения документированы в manifest
Streaming zone planner	Medium	L	Scene graph, runtime telemetry	Показывает gaps, oversized atomic models, persistent targets и spawn streaming risks
Composition cameras и landmark checks	Medium	M	Scene graph, screenshot matrix	Автотест подтверждает видимость landmark и отсутствие критического occlusion из заданных точек
Scene recipe diff	Medium	M	Scene IR, plans	План показывает added/removed/moved/restyled objects по logical IDs, а не только raw Instances
Variant generator	Medium	M	Modular Kit, material palette	Создаёт варианты без дублирования mesh/texture content и с ограниченными property ranges
Asset thumbnail renderer	Medium	M	Camera rig, screenshot	Catalog автоматически получает одинаково кадрированные превью и warning badges
Multi-place package audit	Medium	L	Open Cloud, packages	Отчёт сравнивает package versions во всех выбранных places без автоматической публикации
Lighting profile editor	Medium	M	Dashboard, screenshot matrix	Профили preview/apply/revert; low/medium/high кадры входят в review
Automated art-direction suggestions	Low	M	Style lint, image model integration	Рекомендации не мутируют сцену без отдельного plan; каждый совет привязан к измеримому нарушению
Shared cloud asset library UI	Low	L	Auth, package catalog	Командные permissions и ownership видимы до вставки
Community recipe registry	Low	L	Stable schema, signing	Recipe подписан, versioned, проходит safety validation и не содержит произвольный Luau
Procedural decal/trim placement	Low	M	Spline/surface queries	Preview показывает UV/orientation и предотвращает z-fighting
Automatic LOD asset generation	Low	L	External mesh toolchain	Генерация не заменяет оригинал; quality comparison и triangle targets обязательны
Критические зависимости

Наиболее важная последовательность:

text

Studio conformance
    → typed mutation/result contracts
        → Asset Manifest
            → package/PBR/model workflows
                → modular kits and scatter
                    → visual/performance gates

Начинать со scatter, biome generation или «AI beautify» до завершения Manifest и conformance не рекомендуется: результат будет красивым в одном place, но трудно воспроизводимым, обновляемым и тестируемым.

ChangeHistoryService должен стать обязательным системным контрактом. Roblox указывает, что Studio plugins должны начинать и завершать recording для корректного Undo/Redo; BloxForge уже использует историю изменений, но недавний дефект с необратимым Destroy() показывает, что наличие wrapper само по себе недостаточно без end-to-end acceptance test.
Поэтапная дорожная карта

Дата начала ниже условная — 1 сентября 2026 года. Реальная дата, размер команды и release commitments в запросе не указаны. Каждый макро-спринт должен завершаться usable release, а не только внутренним refactoring branch.

 Oct 2026
 Jan 2027
 Apr 2027
 Jul 2027
 Oct 2027
 Jan 2028
Protocol/version handshake           Windows Studio conformance suite     Mutation/Undo contract               Typed Luau result pipeline           Asset Manifest v1                    Quarantine and AssetService adapter  Reference asset corpus               PBR and import preflight             Package catalog and pinning          Plugin authoring dashboard           Semantic scene graph                 Modular Kit schema                   Deterministic scatter                Spline and terrain layers            Visual snapshot and diff             Performance budgets                  Example maps and documentation       Streaming planner                    Stable professional release          Стабилизация StudioAsset pipelineWorld authoringProfessional QABloxForge — дорожная карта интеграции с Roblox Studio

Макро-спринт «Стабильный Studio-контракт»

Период: сентябрь–ноябрь 2026, три месяца.

Результат: BloxForge доказывает корректность основных операций в настоящем Studio, включая install/update plugin, connect, read, create, set properties, duplicate, delete/undo, screenshot, playtest, runtime logs и clean teardown.

Поставки:

    protocol compatibility matrix;
    Windows Studio canary;
    единая transaction/Undo оболочка;
    versioned structured outputs;
    regression fixtures для всех серьёзных дефектов из changelog;
    обновлённые CONTRIBUTING.md, Known Limitations и issue templates;
    первый benchmark place.

Метрики успеха:
Метрика	Цель
Pass rate обязательного Studio suite	не менее 98% на последних 30 запусках
Необъяснимые outcome_unknown в controlled suite	0
Мутации, корректно откатываемые одним Undo	100% тестируемых edit tools
Critical regression с test ID	100% исправлений из Unreleased changelog
Документные ссылки и generated docs	100% проходят CI
Макро-спринт «Воспроизводимый asset pipeline»

Период: декабрь 2026 – март 2027, четыре месяца.

Результат: модель можно импортировать или загрузить, проверить, связать с исходником, преобразовать в package, обновить и восстановить на другом компьютере без ручного угадывания asset IDs.

Поставки:

    Asset Manifest v1;
    adapters Studio Importer/Open Cloud/AssetService/Package;
    quarantine и script audit;
    PBR, scale, pivot, naming, collision и texture checks;
    package version plan/apply;
    reference corpus: props, modular architecture, vegetation, PBR and intentionally broken assets;
    guided import UI.

Метрики успеха:
Метрика	Цель
Успешная обработка валидного reference corpus	не менее 95%
Instances без provenance после managed import	0
Permission failures с классифицированным remediation	не менее 95%
Повторный import неизменённого source	0 лишних cloud uploads
Обновление package без потери разрешённых overrides	100% тестов
Макро-спринт «Semantic World Authoring»

Период: апрель–август 2027, пять месяцев.

Результат: BloxForge создаёт карты из редактируемых семантических recipes, а не из одноразовых наборов Parts.

Поставки:

    scene graph и zones;
    3D style brief/tokens;
    Modular Kit catalog;
    deterministic scatter;
    spline paths, walls and fences;
    terrain layer stack;
    composition cameras;
    полноценный authoring dashboard.

Метрики успеха:
Метрика	Цель
Повторная генерация с тем же recipe/seed	одинаковый logical scene diff
Время blockout→первый styled pass	снижение минимум на 40% относительно Sprint baseline
Ручные изменения, потерянные при regeneration	0 для declared override zones
Model instances из package/kit catalog	не менее 90% в reference maps
Style lint violations перед review	снижение минимум на 60% после auto-repair plan
Макро-спринт «Профессиональный visual и performance gate»

Период: сентябрь 2027 – февраль 2028, шесть месяцев.

Результат: каждое изменение карты проходит visual, streaming и performance acceptance, а репозиторий содержит эталонные карты и измеримые quality baselines.

Поставки:

    screenshot shot/device/quality matrix;
    perceptual visual diff;
    performance budgets by zone;
    streaming planner;
    lighting profile editor;
    multi-place/package audit;
    три завершённые reference maps;
    стабильный public schema для recipes/plugins.

Метрики успеха:
Метрика	Цель
Visual regressions, обнаруженные до merge	не менее 90% размеченного тестового набора
Reference maps, проходящие mobile budget	100%
Zones без определённого budget	0
Duplicate mesh/texture content в managed library	снижение минимум на 80% от baseline
Время диагностики asset/package regression	менее 15 минут по CI artifact
Успешность onboarding нового contributor	reference change merged за один рабочий день после setup
Инженерный процесс, тестирование и CI/CD

Текущий CI уже выполняет lint, typecheck, Jest, fault-injection, 10 000-request benchmark, plugin compilation, Lune smoke, Rojo 7.7.0 integration, Rokit/Wally integration и cross-platform smoke. Это следует сохранить как нижний слой, а не заменить новым Studio suite.
Рекомендуемая тестовая пирамида
Уровень	Что проверяется	Частота
Type/schema tests	Tool definitions, effects, input/output contracts	Каждый PR
Domain unit tests	Plans, manifests, spatial math, budgets, hashing	Каждый PR
Generated Luau golden tests	Полный emitted source и cancellation/return conventions	Каждый PR
Lune tests	Чистая Luau-логика без Studio engine	Каждый PR
Mock bridge fault tests	Lease, retry, ack, dedup, journal	Каждый PR
Rojo/Rokit/Wally real CLI	Project and toolchain integration	Каждый PR/Linux + nightly OS matrix
Asset corpus tests	GLTF/FBX metadata, PBR maps, invalid fixtures	Каждый PR для local; nightly для upload
Studio canary	Реальный plugin + DataModel + Undo + playtest	Merge queue и nightly
Visual regression	Named cameras and device profiles	Merge queue
Performance benchmark places	Runtime memory/frame/streaming trends	Nightly и release candidate
Release rehearsal	Install package/plugin in clean user profile	Каждый release candidate

Coverage gate лучше внедрять дифференциально: не требовать немедленно произвольные 90% для старого кода, а запретить снижение общего покрытия и потребовать, например, 90% branch coverage для новых manifest/planner modules. Jest уже собирает text, LCOV и HTML coverage, поэтому техническая основа присутствует.
CI/CD pipeline

text

Pull Request
  ├─ format/lint/typecheck
  ├─ unit/schema/golden tests
  ├─ plugin compile + Lune
  ├─ bridge fault tests
  ├─ local asset corpus
  └─ docs/link/generated checks
          ↓
Merge Queue
  ├─ Windows Studio conformance
  ├─ visual snapshot diff
  ├─ reference place smoke
  └─ package manifest reproducibility
          ↓
main
  ├─ npm next package
  ├─ signed plugin artifacts
  ├─ SBOM and checksums
  └─ canary telemetry artifact without place content
          ↓
Release Candidate
  ├─ Windows/macOS clean install
  ├─ real Rojo/Rokit/Wally matrix
  ├─ Open Cloud staging owner
  ├─ performance benchmark suite
  └─ migration tests from previous minor versions
          ↓
latest

Для Studio canary потребуется учитывать отсутствие универсального публичного headless режима для всех Studio-функций. Практический вариант — Windows runner с отдельным тестовым профилем Studio и минимальным тестовым place, где BloxForge управляет запуском и собирает только технические результаты. Такой job следует изолировать от untrusted fork PR и не выдавать ему production credentials.
Структура кода

Предлагаемое разбиение:

text

packages/
  protocol/
    schemas/
    capability-policy/
    conformance/
  bridge/
    transport/
    request-journal/
    studio-sessions/
  world/
    scene-ir/
    spatial-index/
    recipes/
    terrain/
    scatter/
    modular-kits/
  assets/
    manifest/
    validators/
    open-cloud/
    packages/
    quarantine/
  quality/
    visual/
    performance/
    style-lint/
    benchmarks/
  core/
    public-facade/
  robloxstudio-mcp/
  robloxstudio-mcp-inspector/
studio-plugin/
  src/
    app/
    components/
    panels/
    bridge/
    handlers/
    transactions/

Особенно желательно вынести ручное построение plugin UI из одного крупного модуля в переиспользуемые компоненты и theme tokens. Текущий интерфейс содержит фиксированную тёмную палитру и большое число вручную создаваемых Instances; компонентная структура упростит поддержку Studio theme, масштабирования текста и новых authoring panels.
Workflow разработчика

Рекомендуемый цикл изменения:

    Создать issue с user problem, а не только названием новой MCP-команды.
    Для нового domain concept написать короткий ADR или RFC.
    Определить input/output schema и capability effects.
    Реализовать pure planner до Studio mutation.
    Добавить fixture и golden result.
    Реализовать Studio adapter с transaction wrapper.
    Добавить actual Studio acceptance case.
    Обновить generated docs и один end-to-end example.
    Запустить release:check; для art changes — visual и performance suites.
    Выпустить через next, затем повысить до latest после canary window.

В contribution guide нужно исправить отсутствующую ссылку на todo.md, заменить сокращённую команду проверки на актуальный минимальный PR gate и добавить отдельные checklists для protocol, Studio mutation, asset pipeline и documentation changes. Сейчас guide предлагает npm run typecheck && npm test && npm run build, тогда как корневой пакет уже содержит существенно более полный release:check.
Contribution policy

Каждый новый tool или recipe должен отвечать на следующие вопросы:
Обязательный вопрос	Требуемое доказательство
Какова пользовательская задача?	Issue/RFC с примером карты
Почему нельзя собрать это из существующих tools?	Gap analysis
Какие эффекты требуются?	Явный capability list
Можно ли preview до mutation?	Plan или обоснование отсутствия
Как работает Undo?	Studio acceptance test
Что происходит при timeout?	Retry/outcome policy
Как обеспечена детерминированность?	Seed/hash/idempotency test
Как измеряется визуальное качество?	Shot/golden/lint
Как измеряется performance impact?	Budget delta
Как обновляется документация?	Generated reference + tutorial/example
Ориентиры и референсные проекты

Русскоязычные первичные материалы по этим конкретным API в официальном Creator Hub на момент поиска находились непоследовательно: запросы к ожидаемым ru-ru разделам в основном возвращали английские страницы. Поэтому ниже приоритет отдан официальной документации Roblox на английском и первичным страницам проектов; community-источники используются только для UX-ориентиров.
Референс	Что следует перенять	Что не следует копировать напрямую
Roblox Studio Importer	Queue, presets, preview, предупреждения, import as package, разграничение upload/add-to-workspace	Не предполагать, что все интерактивные операции доступны plugin API
Roblox Reimport	Non-destructive update, сопоставление по именам, сохранение Roblox-specific properties	Не полагаться только на локально сохранённые пути
Roblox Packages	Version history, diff, rollback, permissions, graybox→final workflow	Не включать AutoUpdate без policy для modified copies
Roblox AssetService	Sandbox загруженных моделей, controlled loading третьих сторон	Не активировать script capabilities автоматически
Roblox ChangeHistoryService	Одна логическая операция — одна запись Undo/Redo	Не использовать Destroy() там, где требуется восстановление
Roblox performance guidance	Baseline low-end device, streaming, reuse meshes/textures, early budgets	Не превращать примерные counts из документации в универсальные лимиты
Rojo	Filesystem source of truth, project mappings, Git workflow	Не реализовывать параллельный собственный live-sync engine
Rokit	Project-specific pinned toolchain и cross-platform shims	Не разрешать silent fallback на случайный global binary
Wally	Lockable dependency graph и знакомая package-manager модель	Не смешивать Wally code packages с Roblox art package versions
StyLua	Детерминированный formatter и единый Luau style	Не считать formatting заменой semantic validation
rbx-dom	Качественная обработка RBXM/RBXL/XML и reflection metadata	Не связывать public API BloxForge напрямую с внутренними форматами Roblox
F3X	Быстрые viewport operations, низкий порог обучения, прямое manipulation	Не наследовать legacy architecture и нестабильные глобальные режимы
Stravant ResizeAlign / GapFill	Точность, небольшие специализированные tools, предсказуемый результат	Не дробить BloxForge на десятки несвязанных UI-панелей
Brushtool	Brush placement, пользовательский palette, repeatable dressing	Добавить seed, provenance, exclusion zones и performance preview, отсутствующие в простом brush workflow
Archimedes	Понятная работа с кривыми и повторяющимися сегментами	Расширить до editable spline recipe вместо одноразового результата

Итоговый критерий успеха BloxForge — не количество доступных tools, а доля профессионального workflow, которая становится воспроизводимой, проверяемой и обратимой. Проект уже обладает необходимой safety- и transport-основой. Следующий качественный скачок даст не ещё один набор ad hoc генераторов, а связанная система Asset Manifest, Semantic Scene IR, Modular Kits, visual review и performance budgets.
