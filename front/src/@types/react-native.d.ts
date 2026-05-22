/**
 * Type definitions for iOS native modules
 */

export {};

declare module 'react-native' {
  interface NativeModulesStatic {
    IOSCalendarManager: {
      getEvents(
        startDate: string,
        endDate: string,
        limit: number,
        calendar: string
      ): Promise<any[]>;
      createEvent(
        title: string,
        start: string,
        end: string,
        options: any
      ): Promise<any>;
      updateEvent(id: string, updates: any): Promise<any>;
      deleteEvent(id: string): Promise<void>;
      getCalendars(): Promise<any[]>;
    };
    IOSRemindersManager: {
      getReminders(
        list: string,
        isCompleted: boolean | null,
        dueDateStart: string | null,
        dueDateEnd: string | null,
        limit: number
      ): Promise<any[]>;
      createReminder(title: string, options: any): Promise<any>;
      updateReminder(id: string, updates: any): Promise<any>;
      deleteReminder(id: string): Promise<void>;
      getLists(): Promise<any[]>;
      checkPermissionStatus(): Promise<'authorized' | 'denied' | 'notDetermined'>;
      requestPermission(): Promise<boolean>;
      openSettings(): Promise<void>;
    };
    IOSContactsManager: {
      searchContacts(query: string, limit: number): Promise<any[]>;
      getContact(id: string): Promise<any>;
      createContact(contactData: any): Promise<any>;
      updateContact(id: string, updates: any): Promise<any>;
      deleteContact(id: string): Promise<void>;
      getGroups(): Promise<any[]>;
      checkPermissionStatus(): Promise<'authorized' | 'denied' | 'notDetermined'>;
      requestPermission(): Promise<boolean>;
      openSettings(): Promise<void>;
    };
  }
}
