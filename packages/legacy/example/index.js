//@ts-check
import { AucoSDK } from '../dist/index.mjs';

async function getFile(path) {
  const res = await fetch(path);
  const blob = await res.blob();
  let metadata = {
    type: 'application/pdf',
  };
  const file = new File([blob], 'file.pdf', metadata);
  return file;
}

function getConfig(files) {
  /** @type {import('../src/types').Config} */
  const config = {
    iframeId: 'myIframe',
    sdkType: 'upload',
    keyPublic: '',
    language: 'es',
    //customOrigin: 'http://localhost:4200',
    events: {
      onSDKClose: (documentId, redirect, signProfile) => {
        console.log('Este es el documento', documentId);
        console.log('Participantes del documento', signProfile);
      },
      onSDKReady: () => {},
      onSDKToken: () => {
        return new Promise((resolve) => resolve(''));
      },
      onSDKBack: () => {
        window.location.reload();
      },
    },
    env: 'DEV',
    sdkData: {
      userAttributes: {
        email: 'email@auco.ai',
      },
      flowData: {
        type: 'complete',
        files,
        emailData: {
          message: '',
          name: '',
          subject: '',
        },
        platform: 'auco',
        validations: {
          flow: false,
          identification: false,
          identificationCardBack: false,
          selfie: false,
        },
        participants: [
          {
            id: 'id1',
            type: 'signer',
            country: 'CO',
            email: 'firmante1@auco.ai',
            identification: '123',
            identificationType: 'CC',
            name: 'Firmante 1',
            phone: '+573161979572',
          },
          {
            id: 'id2',
            type: 'signer',
            country: 'CO',
            email: 'firmante2@auco.ai',
            identification: '1234',
            identificationType: 'CC',
            name: 'Firmante 2',
            phone: '+573161979572',
          },
          {
            id: 'id3',
            type: 'reader',
            email: 'lector@auco.ai',
            name: 'Lector',
            locked: true,
          },
        ],
      },
      uxOptions: {
        primaryColor: '#021c30',
        alternateColor: '#a557f2ff',
      },
    },
  };
  return config;
}
window.onload = async function () {
  const file1 = await getFile('./files/file.pdf');
  const unsus = AucoSDK(getConfig([file1]));
  // setTimeout(() => unsus(), 5000);
};
