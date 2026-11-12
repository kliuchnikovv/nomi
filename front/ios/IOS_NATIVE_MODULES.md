# iOS Native Modules

Этот документ описывает нативные модули React Native для iOS интеграций.

## IOSContactsManager

Менеджер для работы с Contacts Framework (Контакты iOS).

### Методы

#### `checkPermissionStatus()`
Проверить текущий статус разрешения доступа к контактам.

**Возвращает:** `'authorized' | 'denied' | 'notDetermined'`

- `authorized` - доступ разрешён
- `denied` - доступ запрещён пользователем
- `notDetermined` - пользователь ещё не отвечал на запрос

#### `requestPermission()`
Запросить разрешение на доступ к контактам через системный диалог.

**Возвращает:** `boolean` - `true` если разрешение получено, `false` в противном случае

#### `openSettings()`
Открыть системные настройки iOS на странице настроек приложения для изменения разрешений.

**Возвращает:** `void`

#### `searchContacts(query: string, limit: number)`
Поиск контактов по имени, email или телефону.

**Параметры:**
- `query` - строка поиска
- `limit` - максимальное количество результатов

**Возвращает:** Массив объектов контактов

#### `getContact(id: string)`
Получить детали контакта по идентификатору.

**Параметры:**
- `id` - идентификатор контакта (CNContact identifier)

**Возвращает:** Объект контакта

#### `createContact(contactData: object)`
Создать новый контакт.

**Параметры:** `contactData` - данные контакта (имя, телефон, email и т.д.)

**Возвращает:** Созданный объект контакта

#### `updateContact(id: string, updates: object)`
Обновить существующий контакт.

**Параметры:**
- `id` - идентификатор контакта
- `updates` - поля для обновления

**Возвращает:** Обновлённый объект контакта

#### `deleteContact(id: string)`
Удалить контакт.

**Параметры:**
- `id` - идентификатор контакта

**Возвращает:** `void`

#### `getGroups()`
Получить список групп контактов.

**Возвращает:** Массив групп контактов

---

## IOSRemindersManager

Менеджер для работы с EventKit (Напоминания iOS).

### Методы

#### `checkPermissionStatus()`
Проверить текущий статус разрешения доступа к напоминаниям.

**Возвращает:** `'authorized' | 'denied' | 'notDetermined'`

- `authorized` - доступ разрешён
- `denied` - доступ запрещён пользователем
- `notDetermined` - пользователь ещё не отвечал на запрос

#### `requestPermission()`
Запросить разрешение на доступ к напоминаниям через системный диалог.

**Возвращает:** `boolean` - `true` если разрешение получено, `false` в противном случае

#### `openSettings()`
Открыть системные настройки iOS на странице настроек приложения для изменения разрешений.

**Возвращает:** `void`

#### `getReminders(list, isCompleted, dueDateStart, dueDateEnd, limit)`
Получить напоминания с опциональной фильтрацией.

**Параметры:**
- `list` (опционально) - идентификатор списка напоминаний
- `isCompleted` (опционально) - фильтр по статусу завершения
- `dueDateStart` (опционально) - начало диапазона даты выполнения (ISO формат)
- `dueDateEnd` (опционально) - конец диапазона даты выполнения (ISO формат)
- `limit` - максимальное количество результатов

**Возвращает:** Массив объектов напоминаний

#### `createReminder(title, options)`
Создать новое напоминание.

**Параметры:**
- `title` - заголовок напоминания
- `options` - дополнительные параметры (notes, dueDate, priority, list, url)

**Возвращает:** Созданный объект напоминания

#### `updateReminder(id, updates)`
Обновить существующее напоминание.

**Параметры:**
- `id` - идентификатор напоминания
- `updates` - поля для обновления

**Возвращает:** Обновлённый объект напоминания

#### `completeReminder(id)`
Отметить напоминание как выполненное.

**Параметры:**
- `id` - идентификатор напоминания

**Возвращает:** Обновлённый объект напоминания

#### `deleteReminder(id)`
Удалить напоминание.

**Параметры:**
- `id` - идентификатор напоминания

**Возвращает:** `void`

#### `getLists()`
Получить список списков напоминаний.

**Возвращает:** Массив списков напоминаний

---

## IOSCalendarManager

Менеджер для работы с EventKit (Календарь iOS).

**Примечание:** Полная реализация календаря не включена в данный момент, но нативный модуль подготовлен.

---

## Разрешения iOS

Для работы с интеграциями необходимо добавить соответствующие разрешения в `Info.plist`:

```xml
<key>NSContactsUsageDescription</key>
<string>Nomi needs access to your contacts to help you communicate with people</string>

<key>NSRemindersUsageDescription</key>
<string>Nomi needs access to your reminders to help you stay organized</string>

<key>NSCalendarsUsageDescription</key>
<string>Nomi needs access to your calendar to help manage your events</string>
```

---

## Поток работы с разрешениями

1. **Проверка статуса:** Вызываем `checkPermissionStatus()`
2. **Если не определён:** Запрашиваем через `requestPermission()`
3. **Если запрещён:** Показываем пользователю кнопку для открытия настроек через `openSettings()`
4. **Если разрешён:** Методы работают корректно

Пример потока:

```
Executor → checkPermissionStatus()
    ├─ notDetermined → requestPermission()
    │   ├─ granted → proceed with method
    │   └─ denied → show "enable in settings" message
    ├─ denied → show "enable in settings" message + openSettings()
    └─ authorized → proceed with method
```

---

## Клиентские обёртки (TypeScript)

Для удобства работы используются TypeScript клиенты:

- `IOSContactsClient` - обёртка над `IOSContactsManager`
- `IOSRemindersClient` - обёртка над `IOSRemindersManager`

Они предоставляют типизированные методы и обработку ошибок.

---

## Фоновые задачи

Каждый клиент поддерживает RAG индексацию через метод `indexForRAG()`:

- `IOSContactsClient.indexForRAG(integrationId)` - индексирует контакты
- `IOSRemindersClient.indexForRAG(integrationId)` - индексирует напоминания

Эти методы вызываются автоматически через `BackgroundTaskManager` при включении интеграции.
