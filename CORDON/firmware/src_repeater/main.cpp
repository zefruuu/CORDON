#include <Arduino.h>
#include "protocol.h"

void setup() {
    Serial.begin(115200);
    pinMode(PIN_STATUS_LED, OUTPUT);
    digitalWrite(PIN_STATUS_LED, HIGH);
}

void loop() {
    delay(1000);
}
