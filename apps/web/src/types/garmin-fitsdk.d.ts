declare module "@garmin/fitsdk" {
  export class Stream {
    static fromArrayBuffer(arrayBuffer: ArrayBuffer): Stream;
    static fromByteArray(byteArray: number[]): Stream;
    static fromBuffer(buffer: Buffer): Stream;
    length: number;
    bytesRead: number;
    position: number;
  }

  export class Decoder {
    constructor(stream: Stream);
    isFIT(): boolean;
    checkIntegrity(): boolean;
    read(options?: {
      mesgListener?: (messageNumber: number, message: Record<string, unknown>) => void;
      expandSubFields?: boolean;
      expandComponents?: boolean;
      applyScaleAndOffset?: boolean;
      convertTypesToStrings?: boolean;
      convertDateTimesToDates?: boolean;
      includeUnknownData?: boolean;
      mergeHeartRates?: boolean;
    }): {
      messages: Record<string, unknown[]>;
      errors: unknown[];
    };
  }

  export class Utils {
    static FIT_EPOCH_MS: number;
    static convertDateTimeToDate(fitTimestamp: number): Date;
    static convertDateToDateTime(date: Date): number;
  }
}
