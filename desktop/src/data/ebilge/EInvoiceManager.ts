import {
  EDocumentPayload,
  EDocumentSendResult,
  EDocumentStatusResult,
  IEInvoiceIntegrator,
  RecipientQueryResponse,
} from './EInvoiceIntegrator.interface';
import { GenericEInvoiceIntegrator } from './GenericEInvoiceIntegrator';

/**
 * Universal E-Invoice Provider Manager
 *
 * Implements Dependency Inversion Principle.
 * POS UI and Domain Use Cases interact exclusively with this Manager or interface.
 * Integrator provider swaps (e.g. Logo -> Sovos -> EDM) require zero changes to core business logic.
 */
export class EInvoiceManager implements IEInvoiceIntegrator {
  private static instance: EInvoiceManager | null = null;
  private integrators: Map<string, IEInvoiceIntegrator> = new Map();
  private activeProviderId: string | null = null;

  private constructor() {
    const defaultIntegrator = new GenericEInvoiceIntegrator();
    this.registerIntegrator(defaultIntegrator);
    this.setActiveProvider(defaultIntegrator.providerId);
  }

  public static getInstance(): EInvoiceManager {
    if (!EInvoiceManager.instance) {
      EInvoiceManager.instance = new EInvoiceManager();
    }
    return EInvoiceManager.instance;
  }

  public static resetInstance(): void {
    EInvoiceManager.instance = null;
  }

  public registerIntegrator(integrator: IEInvoiceIntegrator): void {
    this.integrators.set(integrator.providerId, integrator);
    if (!this.activeProviderId) {
      this.activeProviderId = integrator.providerId;
    }
  }

  public setActiveProvider(providerId: string): void {
    if (!this.integrators.has(providerId)) {
      throw new Error(`E-Invoice integrator '${providerId}' is not registered.`);
    }
    this.activeProviderId = providerId;
  }

  public getActiveIntegrator(): IEInvoiceIntegrator {
    if (!this.activeProviderId || !this.integrators.has(this.activeProviderId)) {
      throw new Error('No active e-invoice integrator configured.');
    }
    const integrator = this.integrators.get(this.activeProviderId);
    if (!integrator) {
      throw new Error('Active e-invoice integrator instance missing.');
    }
    return integrator;
  }

  public get providerId(): string {
    return this.getActiveIntegrator().providerId;
  }

  public get providerName(): string {
    return this.getActiveIntegrator().providerName;
  }

  public async sendEArchiveInvoice(document: EDocumentPayload): Promise<EDocumentSendResult> {
    return this.getActiveIntegrator().sendEArchiveInvoice(document);
  }

  public async sendEInvoice(document: EDocumentPayload): Promise<EDocumentSendResult> {
    return this.getActiveIntegrator().sendEInvoice(document);
  }

  public async checkDocumentStatus(documentUuid: string): Promise<EDocumentStatusResult> {
    return this.getActiveIntegrator().checkDocumentStatus(documentUuid);
  }

  public async queryRecipient(taxOrIdNumber: string): Promise<RecipientQueryResponse> {
    const active = this.getActiveIntegrator();
    if (active.queryRecipient) {
      return active.queryRecipient(taxOrIdNumber);
    }
    return {
      isRegistered: false,
      aliases: [],
    };
  }
}
