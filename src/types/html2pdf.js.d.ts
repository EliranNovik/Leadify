declare module 'html2pdf.js' {
  interface Html2PdfOptions {
    margin?: number | number[];
    filename?: string;
    image?: {
      type?: string;
      quality?: number;
    };
    html2canvas?: {
      scale?: number;
      useCORS?: boolean;
      logging?: boolean;
    };
    jsPDF?: {
      unit?: string;
      format?: string;
      orientation?: string;
    };
  }

  interface Html2Pdf {
    set(options: Html2PdfOptions): Html2Pdf;
    from(element: HTMLElement | null): Html2Pdf;
    outputPdf(type?: string): Promise<Blob>;
    then(callback: () => void): Promise<void>;
    catch(callback: (error: any) => void): Promise<void>;
    save(): Promise<void>;
  }

  function html2pdf(element?: HTMLElement | null, options?: Html2PdfOptions): Html2Pdf;
  function html2pdf(options?: Html2PdfOptions): Html2Pdf;

  export default html2pdf;
}

