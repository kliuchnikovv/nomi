//
//  IOSHealthManager.swift
//  Genie
//
//  iOS Health Manager for HealthKit integration
//

import Foundation
import React
import HealthKit

@objc(IOSHealthManager)
class IOSHealthManager: NSObject {

    private let healthStore = HKHealthStore()

    // Helper to parse ISO8601 dates with or without timezone
    private func parseDate(_ dateString: String) -> Date? {
        // Try with timezone first (e.g., "2026-02-16T00:00:00Z")
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: dateString) {
            return date
        }

        // Try without timezone, assume UTC (e.g., "2026-02-16T00:00:00")
        if let date = formatter.date(from: dateString + "Z") {
            return date
        }

        return nil
    }

    // HealthKit type definitions
    private lazy var activityTypes: Set<HKQuantityType> = {
        var types = Set<HKQuantityType>()
        if let stepCount = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            types.insert(stepCount)
        }
        if let distance = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
            types.insert(distance)
        }
        if let activeEnergy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            types.insert(activeEnergy)
        }
        if let exerciseTime = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) {
            types.insert(exerciseTime)
        }
        if let standTime = HKQuantityType.quantityType(forIdentifier: .appleStandTime) {
            types.insert(standTime)
        }
        if let flights = HKQuantityType.quantityType(forIdentifier: .flightsClimbed) {
            types.insert(flights)
        }
        return types
    }()

    private lazy var heartTypes: Set<HKQuantityType> = {
        var types = Set<HKQuantityType>()
        if let heartRate = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            types.insert(heartRate)
        }
        if let restingHeartRate = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) {
            types.insert(restingHeartRate)
        }
        if let hrv = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
            types.insert(hrv)
        }
        return types
    }()

    private lazy var bodyTypes: Set<HKQuantityType> = {
        var types = Set<HKQuantityType>()
        if let weight = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            types.insert(weight)
        }
        if let height = HKQuantityType.quantityType(forIdentifier: .height) {
            types.insert(height)
        }
        if let bmi = HKQuantityType.quantityType(forIdentifier: .bodyMassIndex) {
            types.insert(bmi)
        }
        if let bodyFat = HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage) {
            types.insert(bodyFat)
        }
        return types
    }()

    private lazy var nutritionTypes: Set<HKQuantityType> = {
        var types = Set<HKQuantityType>()
        if let calories = HKQuantityType.quantityType(forIdentifier: .dietaryEnergyConsumed) {
            types.insert(calories)
        }
        if let protein = HKQuantityType.quantityType(forIdentifier: .dietaryProtein) {
            types.insert(protein)
        }
        if let carbs = HKQuantityType.quantityType(forIdentifier: .dietaryCarbohydrates) {
            types.insert(carbs)
        }
        if let fat = HKQuantityType.quantityType(forIdentifier: .dietaryFatTotal) {
            types.insert(fat)
        }
        if let water = HKQuantityType.quantityType(forIdentifier: .dietaryWater) {
            types.insert(water)
        }
        return types
    }()

    override init() {
        super.init()
    }

    // MARK: - Permission Management

    @objc
    func checkPermissionStatus(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard HKHealthStore.isHealthDataAvailable() else {
            resolve(["available": false, "authorized": []])
            return
        }

        var authorizedCategories: [String] = []

        // Check activity types
        if activityTypes.allSatisfy({ healthStore.authorizationStatus(for: $0) == .sharingAuthorized }) {
            authorizedCategories.append("activity")
        }

        // Check heart types
        if heartTypes.allSatisfy({ healthStore.authorizationStatus(for: $0) == .sharingAuthorized }) {
            authorizedCategories.append("heart")
        }

        // Check body types
        if bodyTypes.allSatisfy({ healthStore.authorizationStatus(for: $0) == .sharingAuthorized }) {
            authorizedCategories.append("body")
        }

        // Check nutrition types
        if nutritionTypes.allSatisfy({ healthStore.authorizationStatus(for: $0) == .sharingAuthorized }) {
            authorizedCategories.append("nutrition")
        }

        // Check sleep and workouts
        if let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis),
           healthStore.authorizationStatus(for: sleepType) == .sharingAuthorized {
            authorizedCategories.append("sleep")
        }

        if healthStore.authorizationStatus(for: HKWorkoutType.workoutType()) == .sharingAuthorized {
            authorizedCategories.append("workouts")
        }

        resolve(["available": true, "authorized": authorizedCategories])
    }

    @objc
    func requestPermission(_ categories: [String], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard HKHealthStore.isHealthDataAvailable() else {
            reject("NOT_AVAILABLE", "HealthKit is not available on this device", nil)
            return
        }

        var typesToRead = Set<HKObjectType>()
        var typesToWrite = Set<HKSampleType>()

        for category in categories {
            switch category {
            case "activity":
                typesToRead.formUnion(activityTypes)
            case "heart":
                typesToRead.formUnion(heartTypes)
            case "sleep":
                if let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) {
                    typesToRead.insert(sleepType)
                    typesToWrite.insert(sleepType)
                }
            case "body":
                typesToRead.formUnion(bodyTypes)
                typesToWrite.formUnion(bodyTypes)
            case "nutrition":
                typesToRead.formUnion(nutritionTypes)
                typesToWrite.formUnion(nutritionTypes)
            case "workouts":
                typesToRead.insert(HKWorkoutType.workoutType())
                typesToWrite.insert(HKWorkoutType.workoutType())
            default:
                break
            }
        }

        healthStore.requestAuthorization(toShare: typesToWrite, read: typesToRead) { success, error in
            if let error = error {
                reject("PERMISSION_ERROR", error.localizedDescription, error)
            } else {
                resolve(["granted": success, "categories": categories])
            }
        }
    }

    // MARK: - Activity Queries

    @objc
    func getSteps(_ startDate: String, endDate: String, interval: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        print("[IOSHealthManager] getSteps called: \(startDate) to \(endDate), interval: \(interval)")

        guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            print("[IOSHealthManager] ERROR: Step count type not available")
            reject("TYPE_ERROR", "Step count type not available", nil)
            return
        }

        guard let start = parseDate(startDate),
              let end = parseDate(endDate) else {
            print("[IOSHealthManager] ERROR: Invalid date format - startDate=\(startDate), endDate=\(endDate)")
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        print("[IOSHealthManager] Executing HealthKit query for steps...")
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

        let query = HKStatisticsCollectionQuery(
            quantityType: stepType,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum,
            anchorDate: start,
            intervalComponents: intervalComponents(for: interval)
        )

        query.initialResultsHandler = { query, results, error in
            if let error = error {
                print("[IOSHealthManager] HealthKit query error: \(error.localizedDescription)")
                reject("QUERY_ERROR", error.localizedDescription, error)
                return
            }

            guard let results = results else {
                print("[IOSHealthManager] ERROR: No results returned from HealthKit")
                reject("QUERY_ERROR", "Failed to fetch steps", nil)
                return
            }

            print("[IOSHealthManager] HealthKit query successful, processing results...")
            var stepsData: [[String: Any]] = []
            results.enumerateStatistics(from: start, to: end) { statistics, _ in
                if let sum = statistics.sumQuantity() {
                    let steps = sum.doubleValue(for: HKUnit.count())
                    print("[IOSHealthManager] Found steps: \(steps) for date: \(statistics.startDate)")
                    stepsData.append([
                        "date": statistics.startDate.iso8601String,
                        "value": steps,
                        "unit": "count"
                    ])
                }
            }

            print("[IOSHealthManager] Returning \(stepsData.count) step entries")
            resolve(stepsData)
        }

        healthStore.execute(query)
    }

    @objc
    func getActivitySummary(_ startDate: String, endDate: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let start = parseDate(startDate),
              let end = parseDate(endDate) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

        var summary: [String: Double] = [
            "steps": 0,
            "distance": 0,
            "activeEnergy": 0,
            "exerciseMinutes": 0,
            "standHours": 0,
            "flightsClimbed": 0
        ]

        let group = DispatchGroup()

        // Query steps
        if let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            group.enter()
            querySum(for: stepType, predicate: predicate) { value in
                summary["steps"] = value
                group.leave()
            }
        }

        // Query distance
        if let distanceType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
            group.enter()
            querySum(for: distanceType, predicate: predicate, unit: .meter()) { value in
                summary["distance"] = value
                group.leave()
            }
        }

        // Query active energy
        if let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            group.enter()
            querySum(for: energyType, predicate: predicate, unit: .kilocalorie()) { value in
                summary["activeEnergy"] = value
                group.leave()
            }
        }

        // Query exercise time
        if let exerciseType = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) {
            group.enter()
            querySum(for: exerciseType, predicate: predicate, unit: .minute()) { value in
                summary["exerciseMinutes"] = value
                group.leave()
            }
        }

        // Query stand hours
        if let standType = HKQuantityType.quantityType(forIdentifier: .appleStandTime) {
            group.enter()
            querySum(for: standType, predicate: predicate, unit: .hour()) { value in
                summary["standHours"] = value
                group.leave()
            }
        }

        // Query flights climbed
        if let flightsType = HKQuantityType.quantityType(forIdentifier: .flightsClimbed) {
            group.enter()
            querySum(for: flightsType, predicate: predicate) { value in
                summary["flightsClimbed"] = value
                group.leave()
            }
        }

        group.notify(queue: .main) {
            resolve(summary)
        }
    }

    // MARK: - Heart Queries

    @objc
    func getHeartRate(_ startDate: String, endDate: String, limit: Int, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            reject("TYPE_ERROR", "Heart rate type not available", nil)
            return
        }

        guard let start = parseDate(startDate),
              let end = parseDate(endDate) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(sampleType: heartRateType, predicate: predicate, limit: limit, sortDescriptors: [sortDescriptor]) { query, samples, error in
            guard let samples = samples as? [HKQuantitySample] else {
                reject("QUERY_ERROR", error?.localizedDescription ?? "Failed to fetch heart rate", error)
                return
            }

            let heartRateData = samples.map { sample -> [String: Any] in
                let bpm = sample.quantity.doubleValue(for: HKUnit(from: "count/min"))
                return [
                    "date": sample.startDate.iso8601String,
                    "value": bpm,
                    "unit": "bpm"
                ]
            }

            resolve(heartRateData)
        }

        healthStore.execute(query)
    }

    @objc
    func getRestingHeartRate(_ startDate: String, endDate: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let restingHRType = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) else {
            reject("TYPE_ERROR", "Resting heart rate type not available", nil)
            return
        }

        guard let start = parseDate(startDate),
              let end = parseDate(endDate) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(sampleType: restingHRType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { query, samples, error in
            guard let samples = samples as? [HKQuantitySample] else {
                reject("QUERY_ERROR", error?.localizedDescription ?? "Failed to fetch resting heart rate", error)
                return
            }

            let heartRateData = samples.map { sample -> [String: Any] in
                let bpm = sample.quantity.doubleValue(for: HKUnit(from: "count/min"))
                return [
                    "date": sample.startDate.iso8601String,
                    "value": bpm,
                    "unit": "bpm"
                ]
            }

            resolve(heartRateData)
        }

        healthStore.execute(query)
    }

    // MARK: - Sleep Analysis

    @objc
    func getSleepAnalysis(_ startDate: String, endDate: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            reject("TYPE_ERROR", "Sleep analysis type not available", nil)
            return
        }

        guard let start = parseDate(startDate),
              let end = parseDate(endDate) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { query, samples, error in
            guard let samples = samples as? [HKCategorySample] else {
                reject("QUERY_ERROR", error?.localizedDescription ?? "Failed to fetch sleep data", error)
                return
            }

            // Group sleep samples by date
            var sleepSessions: [[String: Any]] = []
            var currentSession: [HKCategorySample] = []

            for sample in samples.sorted(by: { $0.startDate < $1.startDate }) {
                if currentSession.isEmpty {
                    currentSession = [sample]
                } else if let lastSample = currentSession.last,
                          sample.startDate.timeIntervalSince(lastSample.endDate) < 3600 { // Within 1 hour
                    currentSession.append(sample)
                } else {
                    if !currentSession.isEmpty {
                        sleepSessions.append(self.processSleepSession(currentSession))
                        currentSession = [sample]
                    }
                }
            }

            if !currentSession.isEmpty {
                sleepSessions.append(self.processSleepSession(currentSession))
            }

            resolve(sleepSessions)
        }

        healthStore.execute(query)
    }

    private func processSleepSession(_ samples: [HKCategorySample]) -> [String: Any] {
        guard let firstSample = samples.first, let lastSample = samples.last else {
            return [:]
        }

        let inBedStart = firstSample.startDate
        let inBedEnd = lastSample.endDate

        let asleepSamples = samples.filter { sample in
            if #available(iOS 16.0, *) {
                return sample.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue ||
                       sample.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue ||
                       sample.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
            } else {
                return sample.value == HKCategoryValueSleepAnalysis.asleep.rawValue
            }
        }

        let asleepStart: Date? = asleepSamples.first?.startDate
        let asleepEnd: Date? = asleepSamples.last?.endDate

        let duration = inBedEnd.timeIntervalSince(inBedStart) / 3600.0 // hours

        var session: [String: String] = [
            "date": firstSample.startDate.iso8601String.components(separatedBy: "T")[0],
            "inBedStart": inBedStart.iso8601String,
            "inBedEnd": inBedEnd.iso8601String,
            "duration": String(duration)
        ]

        if let asleepStart = asleepStart {
            session["asleepStart"] = asleepStart.iso8601String
        }
        if let asleepEnd = asleepEnd {
            session["asleepEnd"] = asleepEnd.iso8601String
        }

        return session
    }

    // MARK: - Body Metrics

    @objc
    func getBodyMetrics(_ metricType: String, startDate: String, endDate: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let quantityType = bodyMetricType(for: metricType) else {
            reject("TYPE_ERROR", "Invalid metric type: \(metricType)", nil)
            return
        }

        guard let start = parseDate(startDate),
              let end = parseDate(endDate) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(sampleType: quantityType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { query, samples, error in
            guard let samples = samples as? [HKQuantitySample] else {
                reject("QUERY_ERROR", error?.localizedDescription ?? "Failed to fetch \(metricType)", error)
                return
            }

            let unit = self.unitFor(metricType: metricType)
            let metrics = samples.map { sample -> [String: Any] in
                return [
                    "date": sample.startDate.iso8601String,
                    "value": sample.quantity.doubleValue(for: unit),
                    "unit": unit.unitString
                ]
            }

            resolve(metrics)
        }

        healthStore.execute(query)
    }

    @objc
    func getLatestBodyMetric(_ metricType: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let quantityType = bodyMetricType(for: metricType) else {
            reject("TYPE_ERROR", "Invalid metric type: \(metricType)", nil)
            return
        }

        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(sampleType: quantityType, predicate: nil, limit: 1, sortDescriptors: [sortDescriptor]) { query, samples, error in
            guard let sample = samples?.first as? HKQuantitySample else {
                reject("QUERY_ERROR", "No \(metricType) data found", nil)
                return
            }

            let unit = self.unitFor(metricType: metricType)
            resolve([
                "date": sample.startDate.iso8601String,
                "value": sample.quantity.doubleValue(for: unit),
                "unit": unit.unitString
            ])
        }

        healthStore.execute(query)
    }

    // MARK: - Nutrition

    @objc
    func getNutritionSummary(_ startDate: String, endDate: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let start = parseDate(startDate),
              let end = parseDate(endDate) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)

        var summary: [String: Double] = [
            "calories": 0,
            "protein": 0,
            "carbs": 0,
            "fat": 0,
            "water": 0
        ]

        let group = DispatchGroup()

        // Query calories
        if let caloriesType = HKQuantityType.quantityType(forIdentifier: .dietaryEnergyConsumed) {
            group.enter()
            querySum(for: caloriesType, predicate: predicate, unit: .kilocalorie()) { value in
                summary["calories"] = value
                group.leave()
            }
        }

        // Query protein
        if let proteinType = HKQuantityType.quantityType(forIdentifier: .dietaryProtein) {
            group.enter()
            querySum(for: proteinType, predicate: predicate, unit: .gram()) { value in
                summary["protein"] = value
                group.leave()
            }
        }

        // Query carbs
        if let carbsType = HKQuantityType.quantityType(forIdentifier: .dietaryCarbohydrates) {
            group.enter()
            querySum(for: carbsType, predicate: predicate, unit: .gram()) { value in
                summary["carbs"] = value
                group.leave()
            }
        }

        // Query fat
        if let fatType = HKQuantityType.quantityType(forIdentifier: .dietaryFatTotal) {
            group.enter()
            querySum(for: fatType, predicate: predicate, unit: .gram()) { value in
                summary["fat"] = value
                group.leave()
            }
        }

        // Query water
        if let waterType = HKQuantityType.quantityType(forIdentifier: .dietaryWater) {
            group.enter()
            querySum(for: waterType, predicate: predicate, unit: .literUnit(with: .milli)) { value in
                summary["water"] = value
                group.leave()
            }
        }

        group.notify(queue: .main) {
            resolve(summary)
        }
    }

    // MARK: - Workouts

    @objc
    func getWorkouts(_ startDate: String, endDate: String, workoutType: String, limit: Int, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let start = parseDate(startDate),
              let end = parseDate(endDate) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        var predicates = [HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)]

        if !workoutType.isEmpty, let activityType = workoutActivityType(for: workoutType) {
            predicates.append(HKQuery.predicateForWorkouts(with: activityType))
        }

        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: predicates)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)

        let query = HKSampleQuery(sampleType: HKWorkoutType.workoutType(), predicate: predicate, limit: limit, sortDescriptors: [sortDescriptor]) { query, samples, error in
            guard let workouts = samples as? [HKWorkout] else {
                reject("QUERY_ERROR", error?.localizedDescription ?? "Failed to fetch workouts", error)
                return
            }

            let workoutData = workouts.map { workout -> [String: Any] in
                var data: [String: Any] = [
                    "id": workout.uuid.uuidString,
                    "type": self.workoutTypeName(workout.workoutActivityType),
                    "start": workout.startDate.iso8601String,
                    "end": workout.endDate.iso8601String,
                    "duration": workout.duration / 60.0, // minutes
                    "calories": workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0
                ]

                if let distance = workout.totalDistance?.doubleValue(for: .meter()) {
                    data["distance"] = distance
                }

                if let metadata = workout.metadata {
                    data["metadata"] = metadata
                }

                return data
            }

            resolve(workoutData)
        }

        healthStore.execute(query)
    }

    // MARK: - Aggregated Summaries

    @objc
    func getDailySummary(_ date: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let targetDate = parseDate(date) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: targetDate)
        let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay)!

        let group = DispatchGroup()
        var summary: [String: Any] = ["date": date]

        // Get activity summary
        group.enter()
        getActivitySummary(startOfDay.iso8601String, endDate: endOfDay.iso8601String, resolve: { activityData in
            if let activity = activityData as? [String: Double] {
                summary["activity"] = activity
            }
            group.leave()
        }, reject: { _, _, _ in
            group.leave()
        })

        // Get heart data
        group.enter()
        getHeartRate(startOfDay.iso8601String, endDate: endOfDay.iso8601String, limit: 1000, resolve: { heartData in
            if let heartRates = heartData as? [[String: Any]] {
                let values = heartRates.compactMap { $0["value"] as? Double }
                if !values.isEmpty {
                    summary["heart"] = [
                        "avg": values.reduce(0, +) / Double(values.count),
                        "min": values.min() ?? 0,
                        "max": values.max() ?? 0
                    ]
                }

                // Get resting heart rate
              self.getRestingHeartRate(startOfDay.iso8601String, endDate: endOfDay.iso8601String, resolve: { restingData in
                    if let restingRates = restingData as? [[String: Any]],
                       let firstRate = restingRates.first,
                       let restingValue = firstRate["value"] as? Double {
                        if var heart = summary["heart"] as? [String: Double] {
                            heart["resting"] = restingValue
                            summary["heart"] = heart
                        }
                    }
                    group.leave()
                }, reject: { _, _, _ in
                    group.leave()
                })
            } else {
                group.leave()
            }
        }, reject: { _, _, _ in
            group.leave()
        })

        // Get sleep data
        group.enter()
        getSleepAnalysis(startOfDay.iso8601String, endDate: endOfDay.iso8601String, resolve: { sleepData in
            if let sleepSessions = sleepData as? [[String: Any]], let firstSession = sleepSessions.first {
                let duration = firstSession["duration"] as? Double ?? 0
                summary["sleep"] = [
                    "duration": duration,
                    "quality": duration >= 7 ? "good" : (duration >= 5 ? "fair" : "poor")
                ]
            }
            group.leave()
        }, reject: { _, _, _ in
            group.leave()
        })

        // Get workouts
        group.enter()
        getWorkouts(startOfDay.iso8601String, endDate: endOfDay.iso8601String, workoutType: "", limit: 100, resolve: { workoutsData in
            if let workouts = workoutsData as? [[String: Any]] {
                let workoutSummary = workouts.map { workout in
                    return [
                        "type": workout["type"] as? String ?? "",
                        "duration": workout["duration"] as? Double ?? 0,
                        "calories": workout["calories"] as? Double ?? 0
                    ]
                }
                summary["workouts"] = workoutSummary
            }
            group.leave()
        }, reject: { _, _, _ in
            group.leave()
        })

        group.notify(queue: .main) {
            resolve(summary)
        }
    }

    @objc
    func getWeeklySummary(_ startDate: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let start = parseDate(startDate) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let calendar = Calendar.current
        let startOfWeek = calendar.startOfDay(for: start)
        guard let endOfWeek = calendar.date(byAdding: .day, value: 7, to: startOfWeek) else {
            reject("DATE_ERROR", "Failed to calculate end date", nil)
            return
        }

        let group = DispatchGroup()
        var dailySummaries: [[String: Any]] = []

        for dayOffset in 0..<7 {
            group.enter()
            guard let dayDate = calendar.date(byAdding: .day, value: dayOffset, to: startOfWeek) else {
                group.leave()
                continue
            }

            getDailySummary(dayDate.iso8601String, resolve: { summary in
                if let dailySummary = summary as? [String: Any] {
                    dailySummaries.append(dailySummary)
                }
                group.leave()
            }, reject: { _, _, _ in
                group.leave()
            })
        }

        group.notify(queue: .main) {
            resolve(["summaries": dailySummaries])
        }
    }

    // MARK: - Write Operations

    @objc
    func addWorkout(_ type: String, start: String, duration: Double, calories: Double, distance: Double, metadata: [String: Any], resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let startDate = parseDate(start) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let endDate = startDate.addingTimeInterval(duration * 60) // duration is in minutes
        let activityType = workoutActivityType(for: type) ?? .other

        let totalEnergy = HKQuantity(unit: .kilocalorie(), doubleValue: calories)
        var totalDistance: HKQuantity? = nil
        if distance > 0 {
            totalDistance = HKQuantity(unit: .meter(), doubleValue: distance)
        }

        let workout = HKWorkout(activityType: activityType,
                               start: startDate,
                               end: endDate,
                               duration: duration * 60,
                               totalEnergyBurned: totalEnergy,
                               totalDistance: totalDistance,
                               metadata: metadata.isEmpty ? nil : metadata)

        healthStore.save(workout) { success, error in
            if let error = error {
                reject("SAVE_ERROR", error.localizedDescription, error)
            } else {
                resolve(["success": success, "id": workout.uuid.uuidString])
            }
        }
    }

    @objc
    func addBodyMetric(_ metricType: String, value: Double, date: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let quantityType = bodyMetricType(for: metricType) else {
            reject("TYPE_ERROR", "Invalid metric type: \(metricType)", nil)
            return
        }

        guard let sampleDate = parseDate(date) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        let unit = unitFor(metricType: metricType)
        let quantity = HKQuantity(unit: unit, doubleValue: value)
        let sample = HKQuantitySample(type: quantityType, quantity: quantity, start: sampleDate, end: sampleDate)

        healthStore.save(sample) { success, error in
            if let error = error {
                reject("SAVE_ERROR", error.localizedDescription, error)
            } else {
                resolve(["success": success, "id": sample.uuid.uuidString])
            }
        }
    }

    @objc
    func addNutritionEntry(_ calories: Double, protein: Double, carbs: Double, fat: Double, water: Double, date: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let sampleDate = parseDate(date) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        var samples: [HKQuantitySample] = []

        // Add calories
        if let caloriesType = HKQuantityType.quantityType(forIdentifier: .dietaryEnergyConsumed) {
            let quantity = HKQuantity(unit: .kilocalorie(), doubleValue: calories)
            samples.append(HKQuantitySample(type: caloriesType, quantity: quantity, start: sampleDate, end: sampleDate))
        }

        // Add protein
        if let proteinType = HKQuantityType.quantityType(forIdentifier: .dietaryProtein) {
            let quantity = HKQuantity(unit: .gram(), doubleValue: protein)
            samples.append(HKQuantitySample(type: proteinType, quantity: quantity, start: sampleDate, end: sampleDate))
        }

        // Add carbs
        if let carbsType = HKQuantityType.quantityType(forIdentifier: .dietaryCarbohydrates) {
            let quantity = HKQuantity(unit: .gram(), doubleValue: carbs)
            samples.append(HKQuantitySample(type: carbsType, quantity: quantity, start: sampleDate, end: sampleDate))
        }

        // Add fat
        if let fatType = HKQuantityType.quantityType(forIdentifier: .dietaryFatTotal) {
            let quantity = HKQuantity(unit: .gram(), doubleValue: fat)
            samples.append(HKQuantitySample(type: fatType, quantity: quantity, start: sampleDate, end: sampleDate))
        }

        // Add water
        if let waterType = HKQuantityType.quantityType(forIdentifier: .dietaryWater) {
            let quantity = HKQuantity(unit: .literUnit(with: .milli), doubleValue: water)
            samples.append(HKQuantitySample(type: waterType, quantity: quantity, start: sampleDate, end: sampleDate))
        }

        healthStore.save(samples) { success, error in
            if let error = error {
                reject("SAVE_ERROR", error.localizedDescription, error)
            } else {
                resolve(["success": success])
            }
        }
    }

    @objc
    func addSleepSession(_ inBedStart: String, inBedEnd: String, asleepStart: String, asleepEnd: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            reject("TYPE_ERROR", "Sleep analysis type not available", nil)
            return
        }

        let formatter = ISO8601DateFormatter()
        guard let bedStart = formatter.date(from: inBedStart),
              let bedEnd = formatter.date(from: inBedEnd),
              let sleepStart = formatter.date(from: asleepStart),
              let sleepEnd = formatter.date(from: asleepEnd) else {
            reject("DATE_ERROR", "Invalid date format", nil)
            return
        }

        // Create in-bed sample
        let inBedSample = HKCategorySample(type: sleepType,
                                           value: HKCategoryValueSleepAnalysis.inBed.rawValue,
                                           start: bedStart,
                                           end: bedEnd)

        // Create asleep sample
        let asleepSample = HKCategorySample(type: sleepType,
                                            value: HKCategoryValueSleepAnalysis.asleep.rawValue,
                                            start: sleepStart,
                                            end: sleepEnd)

        healthStore.save([inBedSample, asleepSample]) { success, error in
            if let error = error {
                reject("SAVE_ERROR", error.localizedDescription, error)
            } else {
                resolve(["success": success])
            }
        }
    }

    @objc
    func deleteHealthRecord(_ recordType: String, recordId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
        guard let uuid = UUID(uuidString: recordId) else {
            reject("ID_ERROR", "Invalid record ID", nil)
            return
        }

        let predicate = HKQuery.predicateForObject(with: uuid)
        var sampleType: HKSampleType?

        switch recordType {
        case "workout":
            sampleType = HKWorkoutType.workoutType()
        case "body_metric", "nutrition":
            // For body metrics and nutrition, we need to query all possible types
            // This is a simplified version - in production you might want to be more specific
            reject("NOT_IMPLEMENTED", "Deleting body metrics and nutrition requires specific type information", nil)
            return
        case "sleep":
            sampleType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)
        default:
            reject("TYPE_ERROR", "Unknown record type: \(recordType)", nil)
            return
        }

        guard let type = sampleType else {
            reject("TYPE_ERROR", "Failed to get sample type", nil)
            return
        }

        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: 1, sortDescriptors: nil) { query, samples, error in
            guard let sample = samples?.first else {
                reject("NOT_FOUND", "Record not found", error)
                return
            }

            self.healthStore.delete(sample) { success, error in
                if let error = error {
                    reject("DELETE_ERROR", error.localizedDescription, error)
                } else {
                    resolve(["success": success])
                }
            }
        }

        healthStore.execute(query)
    }

    // MARK: - Helper Methods

    private func intervalComponents(for interval: String) -> DateComponents {
        switch interval {
        case "hour":
            return DateComponents(hour: 1)
        case "week":
            return DateComponents(day: 7)
        default: // "day"
            return DateComponents(day: 1)
        }
    }

    private func querySum(for type: HKQuantityType, predicate: NSPredicate, unit: HKUnit = .count(), completion: @escaping (Double) -> Void) {
        let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { query, statistics, error in
            guard let statistics = statistics, let sum = statistics.sumQuantity() else {
                completion(0)
                return
            }
            completion(sum.doubleValue(for: unit))
        }
        healthStore.execute(query)
    }

    private func bodyMetricType(for metricType: String) -> HKQuantityType? {
        switch metricType {
        case "weight":
            return HKQuantityType.quantityType(forIdentifier: .bodyMass)
        case "height":
            return HKQuantityType.quantityType(forIdentifier: .height)
        case "bmi":
            return HKQuantityType.quantityType(forIdentifier: .bodyMassIndex)
        case "bodyFat":
            return HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage)
        default:
            return nil
        }
    }

    private func unitFor(metricType: String) -> HKUnit {
        switch metricType {
        case "weight":
            return .gramUnit(with: .kilo)
        case "height":
            return .meterUnit(with: .centi)
        case "bmi":
            return .count()
        case "bodyFat":
            return .percent()
        default:
            return .count()
        }
    }

    private func workoutActivityType(for type: String) -> HKWorkoutActivityType? {
        switch type.lowercased() {
        case "running":
            return .running
        case "cycling":
            return .cycling
        case "swimming":
            return .swimming
        case "walking":
            return .walking
        case "hiking":
            return .hiking
        case "yoga":
            return .yoga
        case "strength":
            return .traditionalStrengthTraining
        case "crossfit":
            return .crossTraining
        case "elliptical":
            return .elliptical
        case "rowing":
            return .rowing
        case "stairclimbing":
            return .stairClimbing
        case "dance":
            return .dance
        case "basketball":
            return .basketball
        case "football":
            return .soccer
        case "tennis":
            return .tennis
        case "golf":
            return .golf
        default:
            return nil
        }
    }

    private func workoutTypeName(_ activityType: HKWorkoutActivityType) -> String {
        switch activityType {
        case .running:
            return "running"
        case .cycling:
            return "cycling"
        case .swimming:
            return "swimming"
        case .walking:
            return "walking"
        case .hiking:
            return "hiking"
        case .yoga:
            return "yoga"
        case .traditionalStrengthTraining:
            return "strength"
        case .crossTraining:
            return "crossfit"
        case .elliptical:
            return "elliptical"
        case .rowing:
            return "rowing"
        case .stairClimbing:
            return "stairclimbing"
        case .dance:
            return "dance"
        case .basketball:
            return "basketball"
        case .soccer:
            return "football"
        case .tennis:
            return "tennis"
        case .golf:
            return "golf"
        default:
            return "other"
        }
    }
}

