//
//  IOSNativeModules.m
//  Nomi
//
//  Native module bridge for iOS Calendar, Reminders, and Contacts managers
//

#import <React/RCTBridgeModule.h>

// MARK: - ProjectClassifier

@interface RCT_EXTERN_MODULE(ProjectClassifier, NSObject)

RCT_EXTERN_METHOD(classify:(NSString *)messageText
                  projects:(NSArray *)projects
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

// MARK: - IOSCalendarManager

@interface RCT_EXTERN_MODULE(IOSCalendarManager, NSObject)

RCT_EXTERN_METHOD(getEvents:(NSString *)startDate
                  endDate:(NSString *)endDate
                  limit:(NSInteger)limit
                  calendar:(NSString *)calendar
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createEvent:(NSString *)title
                  start:(NSString *)start
                  end:(NSString *)end
                  options:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateEvent:(NSString *)id
                  updates:(NSDictionary *)updates
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteEvent:(NSString *)id
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getCalendars:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(IOSRemindersManager, NSObject)

RCT_EXTERN_METHOD(getReminders:(NSString *)list
                  isCompleted:(nullable NSNumber *)isCompleted
                  dueDateStart:(nullable NSString *)dueDateStart
                  dueDateEnd:(nullable NSString *)dueDateEnd
                  limit:(NSInteger)limit
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createReminder:(NSString *)title
                  options:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateReminder:(NSString *)id
                  updates:(NSDictionary *)updates
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteReminder:(NSString *)id
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getLists:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(checkPermissionStatus:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(openSettings:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(IOSContactsManager, NSObject)

RCT_EXTERN_METHOD(checkPermissionStatus:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestPermission:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(openSettings:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(searchContacts:(NSString *)query
                  limit:(NSInteger)limit
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getContact:(NSString *)id
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createContact:(NSDictionary *)contactData
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(updateContact:(NSString *)id
                  updates:(NSDictionary *)updates
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteContact:(NSString *)id
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getGroups:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(IOSHealthManager, NSObject)

// Permission Management
RCT_EXTERN_METHOD(checkPermissionStatus:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(requestPermission:(NSArray *)categories
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Activity Queries
RCT_EXTERN_METHOD(getSteps:(NSString *)startDate
                  endDate:(NSString *)endDate
                  interval:(NSString *)interval
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getActivitySummary:(NSString *)startDate
                  endDate:(NSString *)endDate
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Heart Queries
RCT_EXTERN_METHOD(getHeartRate:(NSString *)startDate
                  endDate:(NSString *)endDate
                  limit:(NSInteger)limit
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getRestingHeartRate:(NSString *)startDate
                  endDate:(NSString *)endDate
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Sleep Analysis
RCT_EXTERN_METHOD(getSleepAnalysis:(NSString *)startDate
                  endDate:(NSString *)endDate
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Body Metrics
RCT_EXTERN_METHOD(getBodyMetrics:(NSString *)metricType
                  startDate:(NSString *)startDate
                  endDate:(NSString *)endDate
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getLatestBodyMetric:(NSString *)metricType
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Nutrition
RCT_EXTERN_METHOD(getNutritionSummary:(NSString *)startDate
                  endDate:(NSString *)endDate
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Workouts
RCT_EXTERN_METHOD(getWorkouts:(NSString *)startDate
                  endDate:(NSString *)endDate
                  workoutType:(NSString *)workoutType
                  limit:(NSInteger)limit
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Aggregated Summaries
RCT_EXTERN_METHOD(getDailySummary:(NSString *)date
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getWeeklySummary:(NSString *)startDate
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

// Write Operations
RCT_EXTERN_METHOD(addWorkout:(NSString *)type
                  start:(NSString *)start
                  duration:(double)duration
                  calories:(double)calories
                  distance:(double)distance
                  metadata:(NSDictionary *)metadata
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(addBodyMetric:(NSString *)metricType
                  value:(double)value
                  date:(NSString *)date
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(addNutritionEntry:(double)calories
                  protein:(double)protein
                  carbs:(double)carbs
                  fat:(double)fat
                  water:(double)water
                  date:(NSString *)date
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(addSleepSession:(NSString *)inBedStart
                  inBedEnd:(NSString *)inBedEnd
                  asleepStart:(NSString *)asleepStart
                  asleepEnd:(NSString *)asleepEnd
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteHealthRecord:(NSString *)recordType
                  recordId:(NSString *)recordId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(IOSShortcutsManager, NSObject)

RCT_EXTERN_METHOD(getSirikitShortcuts:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(runShortcut:(NSString *)name
                   input:(nullable NSString *)input
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(donateShortcut:(NSString *)name
                   suggestedPhrase:(NSString *)suggestedPhrase
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(importShortcut:(NSString *)fileUrl
                   name:(NSString *)name
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(IOSMailManager, NSObject)

RCT_EXTERN_METHOD(testConnection:(NSDictionary *)config
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(listMailboxes:(NSDictionary *)config
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(fetchEmails:(NSDictionary *)config
                   mailbox:(NSString *)mailbox
                   limit:(NSInteger)limit
                   sinceUid:(NSInteger)sinceUid
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(fetchEmailBody:(NSDictionary *)config
                   mailbox:(NSString *)mailbox
                   uid:(NSInteger)uid
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(sendEmail:(NSDictionary *)smtpConfig
                   message:(NSDictionary *)message
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(moveEmail:(NSDictionary *)config
                   mailbox:(NSString *)mailbox
                   uid:(NSInteger)uid
                   destinationMailbox:(NSString *)destinationMailbox
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(deleteEmail:(NSDictionary *)config
                   mailbox:(NSString *)mailbox
                   uid:(NSInteger)uid
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setFlags:(NSDictionary *)config
                   mailbox:(NSString *)mailbox
                   uid:(NSInteger)uid
                   flags:(NSString *)flags
                   remove:(BOOL)remove
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(searchMailbox:(NSDictionary *)config
                   mailbox:(NSString *)mailbox
                   searchCriteria:(NSString *)searchCriteria
                   limit:(NSInteger)limit
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject)

@end
