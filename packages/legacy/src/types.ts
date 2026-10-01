export type Languages = 'es' | 'en';
export type SDKs =
  | 'upload'
  | 'upload-v2'
  | 'read'
  | 'attachments'
  | 'validation-attachments'
  | 'validation'
  | 'sign'
  | 'list-validation'
  | 'fill';
export type EnvType = 'DEV' | 'STAGE' | 'PROD';
export type SDKTypeObjectKeys = {
  [x in SDKs]: string;
};
export type SDKEvents = {
  onSDKReady: () => void;
  onSDKBack?: () => void;
  onSDKClose: (documentId?: string, redirectTo?: string) => void;
  onSDKFinish?: () => void;
  onSDKToken?: () => Promise<string>;
  onSDKPay?: (data: {
    code: string;
    epaycoKey: string;
    validation?: boolean;
    packageId?: string;
  }) => void;
  onSDKNotification?: ({
    message,
    options,
  }: {
    message: string;
    options: NotificationOptions;
  }) => void;
};
interface BaseConfig {
  keyPublic?: string;
  keyPrivate?: string;
  country?: string;
  iframeId: string;
  language: Languages;
  events: SDKEvents;
  customOrigin?: string;
  env: EnvType;
}
interface userAttributes {
  name?: string;
  email?: string;
  phone?: string;
  identification?: string;
  identificationType?: string;
  country?: string;
}

interface BaseParticipantAttributes extends userAttributes {
  type: 'signer' | 'approver' | 'reader';
  id: string;
  locked?: boolean;
}

interface SignerAttributes extends BaseParticipantAttributes {
  type: 'signer' | 'approver';
  otpCode?: boolean;
  camera?: boolean;
  video?: boolean;
  disableAutoSign?: boolean;
  options?: {
    camera?: string;
    whatsapp?: boolean;
    flow?: boolean;
  };
}

interface ReaderAttributes
  extends Pick<
    BaseParticipantAttributes,
    'name' | 'email' | 'id' | 'type' | 'locked'
  > {
  type: 'reader';
}

interface IFullFlowData {
  type: 'complete';
  participants: (SignerAttributes | ReaderAttributes)[];
  files: File[];
  platform: 'whatsapp' | 'auco';
  validations: {
    otpCode?: 'phone' | 'email';
    selfie: boolean;
    identification: boolean;
    identificationCardBack: boolean;
    flow: boolean;
  };
  emailData: {
    name: string;
    message: string;
    subject: string;
    expire?: Date;
    remember?: '3' | '6' | '12' | '24' | '48';
    notificationOff?: boolean;
  };
}

interface IEditFlowData {
  type: 'edit';
  code: string;
  keepPositions?: boolean;
  participants?: (SignerAttributes | ReaderAttributes)[];
  files?: File[];
  platform?: 'whatsapp' | 'auco';
  validations?: {
    otpCode?: 'phone' | 'email';
    selfie: boolean;
    identification: boolean;
    identificationCardBack: boolean;
    flow: boolean;
  };
  emailData?: {
    name: string;
    message: string;
    subject: string;
    expire?: Date;
    remember?: '3' | '6' | '12' | '24' | '48';
    notificationOff?: boolean;
  };
}

interface IFlowDataOnlyParticipants {
  type: 'participants';
  participants: (SignerAttributes | ReaderAttributes)[];
}

export interface SDKUploadData {
  userAttributes?: userAttributes;
  users?: (SignerAttributes | ReaderAttributes)[];
  flowData?: IFullFlowData | IFlowDataOnlyParticipants | IEditFlowData;
  custom?: Record<string, unknown>;
  uxOptions: {
    primaryColor: string;
    alternateColor: string;
    redirectUrl?: string;
    hoverColor?: string;
    icons?: {
      gradient: string[];
    };
  };
}
interface SDKUpload extends Omit<BaseConfig, 'events'> {
  /**
   * Create an upload flow with signers and approvers
   */
  sdkType: 'upload';
  sdkData: SDKUploadData;
  events: Omit<BaseConfig['events'], 'onSDKClose'> & {
    onSDKClose: (
      documentId?: string,
      redirectTo?: string,
      signProfile?: Array<{
        id: string;
        name: string;
        email: string;
        phone: string;
      }>
    ) => void;
  };
}

interface SDKUploadV2 extends Omit<BaseConfig, 'events'> {
  sdkType: 'upload-v2';
  sdkData: Omit<SDKUploadData, 'flowData'>;
  events: Omit<BaseConfig['events'], 'onSDKClose'> & {
    onSDKClose: (
      documentId?: string,
      redirectTo?: string,
      signProfile?: Array<{
        id: string;
        name: string;
        email: string;
        phone: string;
      }>
    ) => void;
  };
}

interface SDKAttachments extends Omit<BaseConfig, 'events'> {
  /**
   * Create an attachment flow with signers. You could not add approvers.
   *  In this flow there is only one approver, that is the person who creates it.
   */
  sdkType: 'attachments';
  sdkData: SDKUploadData;
  events: SDKEvents;
}
interface SDKRead extends Omit<BaseConfig, 'events'> {
  /**
   * Create an read flow with readers or generate a read link.
   */
  sdkType: 'read';
  sdkData: SDKUploadData;
  events: SDKEvents;
}
interface SDKValidationAttachments extends Omit<BaseConfig, 'events'> {
  /**
   * Create an attachment flow with validation in restrictive list. You could not add approvers.
   */
  sdkType: 'validation-attachments';
  sdkData: SDKUploadData;
  events: SDKEvents;
}
interface SDKSign extends BaseConfig {
  /**
   * Sign flow, use this flow to let your users sign your documents
   */
  sdkType: 'sign';
  sdkData: {
    /**
     * Document Id , also known as code
     */
    document: string;
    image?: string;
    name?: string;
    uxOptions: {
      primaryColor: string;
      alternateColor: string;
      redirectUrl?: string;
      hoverColor?: string;
      icons?: {
        gradient: string[];
      };
    };
    signFlow?: 'document' | 'approve' | 'package' | 'read';
    /**
     * Remove "Your invitation" badge when user has multiple pending documents
     * assumes user didn't open a specific document, and is opening the sign flow from a list of pending documents
     */
    isFromDashboard?: boolean;
    /**
     * email is needed on read functionality when user is logged in
     */
    email?: string;
  };
}
interface SDKValidation extends Omit<BaseConfig, 'events'> {
  /**
   * Create a validation flow, Your customer validate his face against his
   * ID Photo and you receive a response with the similarity between those two photos
   */
  sdkType: 'validation';
  events: Omit<BaseConfig['events'], 'onSDKClose'> & {
    onSDKClose: (similarity?: number, status?: string) => void;
  };
  sdkData: {
    /**
     * code from /validate API response
     */
    document: string;
    uxOptions: {
      primaryColor: string;
      alternateColor: string;
      redirectUrl?: string;
      hoverColor?: string;
      icons?: {
        gradient: string[];
      };
    };
  };
}
interface SDKListValidation extends Omit<BaseConfig, 'events'> {
  sdkType: 'list-validation';
  sdkData: Omit<SDKUploadData, 'userAttributes'> & {
    showPrices: boolean;
  };
  events: Required<SDKEvents>;
}

interface SDKFill extends BaseConfig {
  sdkType: 'fill';
  sdkData: {
    /**
     * template Id
     */
    document: string;
    /**
     * code if is editing template or finishing prebuild
     */
    code?: string;
    /**
     * prebuild if it's first prebuild phase
     */
    preBuild?: boolean;
    /**
     * reference if is filling a reusedocument
     */
    reference?: string;
    uxOptions: {
      primaryColor: string;
      alternateColor: string;
      redirectUrl?: string;
      hoverColor?: string;
      icons?: {
        gradient: string[];
      };
    };
  };
}

export type Config =
  | SDKUpload
  | SDKUploadV2
  | SDKRead
  | SDKAttachments
  | SDKValidationAttachments
  | SDKSign
  | SDKValidation
  | SDKListValidation
  | SDKFill;
export type TAucoSDK = (params: Config) => () => void;
