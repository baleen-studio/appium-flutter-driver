import 'dart:async' show StreamSink;

import 'package:rxdart/rxdart.dart'
    show BehaviorSubject, WithLatestFromExtensions;

final counterSubject = BehaviorSubject<int>.seeded(0);
final counterStream = counterSubject.stream;

final plusClickSubject = BehaviorSubject<void>();
final StreamSink plusClickSink = plusClickSubject;

void init() {
  plusClickSubject.stream.withLatestFrom<int, int>(
    counterSubject,
    (_, a) => a + 1,
  ).pipe(counterSubject);
}
