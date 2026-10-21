#include <Arduino.h>
#include <SPI.h>
#include <RadioLib.h>
#include "protocol.h"

// PIN_CC1101_CS   = 7
// PIN_CC1101_SCK  = 4
// PIN_CC1101_MOSI = 6
// PIN_CC1101_MISO = 5
// PIN_CC1101_GDO0 = 3
// PIN_STATUS_LED  = 8

CC1101 radio = new Module(PIN_CC1101_CS, PIN_CC1101_GDO0, RADIOLIB_NC, PIN_CC1101_GDO2);


volatile bool packetReceivedFlag = false;
bool radioReady = false;
uint32_t lastStatusMs = 0;


struct DedupEntry {
    uint8_t  node_id;
    uint16_t seq_number;
    bool     used;
};

DedupEntry dedupBuffer[DEDUP_BUFFER_SIZE] = {};
uint8_t dedupIndex = 0;



#if defined(ESP8266) || defined(ESP32)
ICACHE_RAM_ATTR
#endif
void onRadioPacketInterrupt(void) {
    packetReceivedFlag = true;
}


bool isDuplicatePacket(uint8_t nodeId, uint16_t seqNum) {
    for (int i = 0; i < DEDUP_BUFFER_SIZE; i++) {
        if (dedupBuffer[i].used && dedupBuffer[i].node_id == nodeId && dedupBuffer[i].seq_number == seqNum) {
            return true;
        }
    }
    dedupBuffer[dedupIndex].node_id = nodeId;
    dedupBuffer[dedupIndex].seq_number = seqNum;
    dedupBuffer[dedupIndex].used = true;
    dedupIndex = (dedupIndex + 1) % DEDUP_BUFFER_SIZE;

    return false;
}



bool initRadioCC1101() {

    SPI.begin(PIN_CC1101_SCK, PIN_CC1101_MISO, PIN_CC1101_MOSI, PIN_CC1101_CS);

    int state = radio.begin(CORDON_RF_FREQ_MHZ, 4.8, 25.0, 135.0, 10, 32);
    if (state != RADIOLIB_ERR_NONE) {
        Serial.printf("[REPEATER] CC1101 init error: %d\n", state);
        return false;
    }


    radio.setSyncWord(0xC0, 0x26);
    radio.setCrcFiltering(false);
    radio.fixedPacketLengthMode(sizeof(CordonPacket));
    radio.setPacketReceivedAction(onRadioPacketInterrupt);

    state = radio.startReceive();
    if (state != RADIOLIB_ERR_NONE) {
        Serial.printf("[GATEWAY] CC1101 startReceive error: %d\n", state);
        return false;
    }

    return true;
}

void setup() {
    pinMode(PIN_STATUS_LED, OUTPUT);
    digitalWrite(PIN_STATUS_LED, HIGH);
    Serial.begin(115200);
    delay(2000);

    radioReady = initRadioCC1101();
    if (radioReady) {
        Serial.println("[REPEATER] CC1101 Init OK! Listening on 433.92 MHz");
        digitalWrite(PIN_STATUS_LED, LOW);
    } else {
        Serial.println("[REPEATER] Failed to initialize CC1101");
    }
}

void loop {
    
}