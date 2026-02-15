# Сводка изменений: Переработка iOS интеграций без UI

## Выполненные изменения

### 1. Регистрация плагинов
- **Файл:** `front/src/plugins/registerClientPlugins.tsx`
- **Изменения:**
  - Убраны импорты UI компонентов: `IOSContactsPluginScreen`, `IOSRemindersPluginScreen`
  - Убран `MainComponent` из регистрации `ios_contacts` и `ios_reminders`
  - Для `ios_calendar` оставлен `MainComponent` (требуется для функциональности)

### 2. IOSRemindersClient
- **Файл:** `front/src/services/integrations/clients/IOSRemindersClient.ts`
- **Добавлено:**
  - Метод `openSettings()` - открывает системные настройки для управления разрешениями

### 3. IOSContactsClient
- **Файл:** `front/src/services/integrations/clients/IOSContactsClient.ts`
- **Добавлено:**
  - Метод `checkPermissionStatus()` - проверяет текущий статус разрешения
  - Метод `requestPermission()` - запрашивает разрешение через системный диалог
  - Метод `openSettings()` - открывает системные настройки

### 4. IOSRemindersManager (Swift)
- **Файл:** `front/ios/genie/IOSRemindersManager.swift`
- **Добавлено:**
  - Импорт `UIKit` для работы с настройками
  - Метод `openSettings()` - открывает `UIApplication.openSettingsURLString`

### 5. IOSContactsManager (Swift)
- **Файл:** `front/ios/genie/IOSContactsManager.swift`
- **Добавлено:**
  - Импорт `UIKit` для работы с настройками
  - Метод `checkPermissionStatus()` - возвращает статус разрешения Contacts
  - Метод `requestPermission()` - вызывает приватный метод запроса разрешений
  - Метод `openSettings()` - открывает системные настройки

### 6. IOSNativeModules.m (Objective-C мост)
- **Файл:** `front/ios/genie/IOSNativeModules.m`
- **Добавлены экспорты:**
  - Для `IOSContactsManager`: `checkPermissionStatus`, `requestPermission`, `openSettings`
  - Для `IOSRemindersManager`: `openSettings`

### 7. Удалены UI компоненты
- **Удалены файлы:**
  - `plugins/ios_contacts/client/components/IOSContactsPluginScreen.tsx`
  - `plugins/ios_reminders/client/components/IOSRemindersPluginScreen.tsx`

### 8. Обновлены исполнители (executors)
- **Файлы:**
  - `plugins/ios_contacts/client/executor.ts`
  - `plugins/ios_reminders/client/executor.ts`
- **Добавлена логика:**
  - Перед выполнением любого метода проверяется статус разрешения
  - Если `notDetermined` - автоматически запрашивается разрешение
  - Если `denied` - возвращается сообщение с инструкцией открыть настройки
  - Если `authorized` - метод выполняется нормально

### 9. Документация
- **Файл:** `front/ios/IOS_NATIVE_MODULES.md` (новый)
- **Содержание:**
  - Полная документация методов `IOSContactsManager`, `IOSRemindersManager`, `IOSCalendarManager`
  - Описание разрешений iOS
  - Поток работы с разрешениями
  - Примеры использования

---

## Поток работы с разрешениями

### Подключение интеграции

```
Пользователь включает "iOS Contacts" в настройках
    ↓
ConnectorsProvider.toggleTool('ios_contacts', true)
    ↓
Создаётся запись в локальной базе данных
    ↓
При первом вызове метода (например, search_contacts)
    ↓
IOSContactsPlugin.execute() → checkPermissionStatus()
    ├─ notDetermined → requestPermission()
    │   ├─ granted → выполнить метод
    │   └─ denied → сообщение: "grant access to Contacts in settings"
    ├─ denied → сообщение: "enable in iOS Settings > Genie > Contacts"
    └─ authorized → выполнить метод
```

### Вызов методов AI агентом

```
Python Agent → client_action → IOSContactsPlugin.execute()
    ↓
Проверка разрешений
    ↓
Если разрешено: IOSContactsClient → IOSContactsManager → Contacts Framework
Если запрещено: возвращается инструкция для пользователя
```

---

## Преимущества новой архитектуры

1. **Нет UI компонент** - интеграции работают без отдельных экранов
2. **Системный поток разрешений** - стандартный iOS подход к разрешениям
3. **Автоматический запрос** - интеграции сами запрашивают разрешение при необходимости
4. **Ясные сообщения** - пользователь получает понятные инструкции при отказе
5. **AI инструменты работают** - все методы доступны AI агентам как инструменты
6. **Фоновые задачи сохранены** - RAG индексация продолжается работать
7. **Упрощённая регистрация** - не нужно указывать `MainComponent`

---

## Оставшиеся компоненты

### IOSCalendar
- **Почему остался UI:** Для календаря функциональность требует отображения событий
- **MainComponent:** `IOSCalendarPluginScreen` оставлен в регистрации
- **Совершенствование:** Можно добавить методы разрешений по аналогии с Contacts/Reminders

---

## Тестирование

### Проверки для локального тестирования:
1. Включить интеграцию в настройках приложения
2. Первое использование метода - должен появиться системный диалог разрешения
3. Разрешить доступ - методы должны работать корректно
4. Запретить доступ и использовать снова - должно появиться сообщение с инструкцией
5. Кнопка "Открыть настройки" должна перенаправлять в системные настройки
6. RAG индексация должна работать в фоне
7. AI агент должен иметь доступ к инструментам Contacts/Reminders

### Проверка сборки:
```bash
cd front
npm run lint  # Проверка linting
```

Примечание: Текущие ошибки TypeScript не связаны с изменениями в iOS интеграциях - это существующие проблемы с типами React Native в проекте.

---

## Следующие шаги (опционально)

1. Добавить методы разрешений в `IOSCalendarManager` для единообразия
2. Обновить UI настроек приложения для отображения статуса разрешений
3. Добавить кнопку "Открыть настройки" в экран настроек интеграций
4. Добавить обработку ошибки `PERMISSION_DENIED` в `ClientToolExecutor`
5. Добавить визуальный индикатор (иконка) для интеграций без разрешений
