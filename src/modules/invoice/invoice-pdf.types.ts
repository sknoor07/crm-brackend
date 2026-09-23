export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string;

  customer: {
    name: string;
    email: string;
    gstin:string |null;
    phone: string | null;
    billingAddress: string | null;
  };

  job: {
    jobNumber: string;
  };

  items: {
    deviceName: string;
    deviceCategory: string;
    serialNumber: string | null;

    components: {
      name: string;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
      warrantyMonths: number;
    }[];
  }[];

  subtotal: string;
  serviceCharge: string;
  discount: string;

  cgst: string | null;
  sgst: string | null;
  igst: string | null;
  gstType: 'none' | 'intra_state' | 'inter_state';

  totalAmount: string;
  currency: string;
}