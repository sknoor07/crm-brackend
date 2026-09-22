export interface InvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string;

  customer: {
    name: string;
    email: string;
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

  totalAmount: string;
  currency: string;
}