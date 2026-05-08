import jsPDF from "jspdf";
import type { SessionRow as Session } from "../../shared/types";

export interface InvoiceCustomization {
  companyName: string;
  notes?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
}

export interface InvoiceTemplate {
  name: string;
  headerBgColor: [number, number, number];
  accentColor: [number, number, number];
  fontSize: {
    title: number;
    heading: number;
    body: number;
    small: number;
  };
}

// Default template - can be extended with more in the future
export const DEFAULT_TEMPLATE: InvoiceTemplate = {
  name: "Professional",
  headerBgColor: [41, 128, 185], // Blue
  accentColor: [52, 152, 219], // Lighter blue
  fontSize: {
    title: 24,
    heading: 12,
    body: 10,
    small: 8,
  },
};

export interface InvoiceData {
  projects: Array<{
    projectId: string;
    projectName: string;
    billableSessions: Session[];
    totalHours: number;
    hourlyRate: number;
    subtotal: number;
  }>;
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  customization: InvoiceCustomization;
  template: InvoiceTemplate;
}

export function generateInvoicePDF(invoiceData: InvoiceData): jsPDF {
  const doc = new jsPDF();
  const template = invoiceData.template;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let yPosition = margin;

  // Helper function to check if we need a new page
  const checkNewPage = (minSpace: number) => {
    if (yPosition + minSpace > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  // Header section
  doc.setFillColor(...template.headerBgColor);
  doc.rect(0, 0, pageWidth, 40, "F");

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(template.fontSize.title);
  doc.text("INVOICE", margin, 25);

  // Invoice details
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(template.fontSize.body);
  yPosition = 50;

  doc.text(
    `Invoice #: ${invoiceData.customization.invoiceNumber || "INV-" + Date.now()}`,
    margin,
    yPosition,
  );
  yPosition += 6;
  doc.text(
    `Date: ${formatDate(invoiceData.customization.invoiceDate || new Date())}`,
    margin,
    yPosition,
  );
  yPosition += 6;
  if (invoiceData.customization.dueDate) {
    doc.text(
      `Due Date: ${formatDate(invoiceData.customization.dueDate)}`,
      margin,
      yPosition,
    );
    yPosition += 6;
  }

  // Company name
  doc.setFontSize(template.fontSize.heading);
  yPosition += 4;
  doc.text(`From: ${invoiceData.customization.companyName}`, margin, yPosition);
  yPosition += 8;

  // Date range
  doc.setFontSize(template.fontSize.body);
  doc.setTextColor(100, 100, 100);
  doc.text(
    `Invoice Period: ${formatDate(invoiceData.dateRange.startDate)} to ${formatDate(invoiceData.dateRange.endDate)}`,
    margin,
    yPosition,
  );
  yPosition += 10;

  // Projects and sessions table
  doc.setTextColor(0, 0, 0);

  // Table header
  doc.setFillColor(...template.accentColor);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(template.fontSize.body);

  const colWidths = {
    date: 25,
    description: 60,
    duration: 25,
    rate: 25,
    amount: 30,
  };
  const colStartX = {
    date: margin,
    description: margin + colWidths.date + 2,
    duration: margin + colWidths.date + colWidths.description + 4,
    rate:
      margin + colWidths.date + colWidths.description + colWidths.duration + 6,
    amount:
      margin +
      colWidths.date +
      colWidths.description +
      colWidths.duration +
      colWidths.rate +
      8,
  };

  // Draw header
  const headerHeight = 7;
  doc.rect(
    margin - 2,
    yPosition - 4,
    pageWidth - 2 * margin + 4,
    headerHeight,
    "F",
  );
  doc.text("Date", colStartX.date, yPosition);
  doc.text("Description", colStartX.description, yPosition);
  doc.text("Hours", colStartX.duration, yPosition);
  doc.text("Rate", colStartX.rate, yPosition);
  doc.text("Amount", colStartX.amount, yPosition);

  yPosition += 8;
  doc.setTextColor(0, 0, 0);

  // Table rows
  for (const project of invoiceData.projects) {
    checkNewPage(15);

    // Project header
    doc.setFontSize(template.fontSize.heading);
    doc.setTextColor(...template.headerBgColor);
    doc.text(`${project.projectName}`, margin, yPosition);
    yPosition += 6;

    doc.setFontSize(template.fontSize.body);
    doc.setTextColor(0, 0, 0);

    // Sessions for this project
    for (const session of project.billableSessions) {
      checkNewPage(5);

      const startDate = new Date(session.start_time).toLocaleDateString();
      const duration = (session.duration / 3600).toFixed(2);
      const amount = (parseFloat(duration) * project.hourlyRate).toFixed(2);

      doc.text(startDate, colStartX.date, yPosition);
      doc.text(
        session.description || "(No description)",
        colStartX.description,
        yPosition,
        { maxWidth: colWidths.description - 2 },
      );
      doc.text(duration, colStartX.duration, yPosition);
      doc.text(`$${project.hourlyRate.toFixed(2)}`, colStartX.rate, yPosition);
      doc.text(`$${amount}`, colStartX.amount, yPosition);

      yPosition += 5;
    }

    // Project subtotal
    doc.setTextColor(...template.accentColor);
    doc.setFontSize(template.fontSize.heading);
    yPosition += 2;
    doc.text(
      `Project Total: $${project.subtotal.toFixed(2)}`,
      colStartX.amount - 20,
      yPosition,
    );
    yPosition += 6;
    doc.setTextColor(0, 0, 0);
  }

  // Grand total
  checkNewPage(15);
  const grandTotal = invoiceData.projects.reduce(
    (sum, p) => sum + p.subtotal,
    0,
  );
  doc.setFontSize(template.fontSize.heading);
  doc.setTextColor(...template.headerBgColor);
  yPosition += 3;
  doc.text(
    `TOTAL: $${grandTotal.toFixed(2)}`,
    colStartX.amount - 15,
    yPosition,
  );

  // Notes section
  if (invoiceData.customization.notes) {
    checkNewPage(20);
    yPosition += 12;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(template.fontSize.heading);
    doc.text("Notes:", margin, yPosition);
    yPosition += 6;
    doc.setFontSize(template.fontSize.body);
    const notesLines = doc.splitTextToSize(
      invoiceData.customization.notes,
      pageWidth - 2 * margin,
    );
    doc.text(notesLines, margin, yPosition);
  }

  // Footer
  doc.setFontSize(template.fontSize.small);
  doc.setTextColor(150, 150, 150);
  doc.text("Thank you for your business!", pageWidth / 2, pageHeight - 10, {
    align: "center",
  });

  return doc;
}

export function downloadInvoicePDF(
  doc: jsPDF,
  filename: string = "invoice.pdf",
): void {
  doc.save(filename);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function calculateInvoiceData(
  projects: Array<{
    projectId: string;
    projectName: string;
    hourlyRate: number;
    billableSessions: Session[];
  }>,
  dateRange: { startDate: Date; endDate: Date },
  customization: InvoiceCustomization,
  template: InvoiceTemplate = DEFAULT_TEMPLATE,
): InvoiceData {
  const projectsData = projects.map((p) => {
    const totalSeconds = p.billableSessions.reduce(
      (sum, s) => sum + s.duration,
      0,
    );
    const totalHours = totalSeconds / 3600;
    const subtotal = totalHours * p.hourlyRate;

    return {
      projectId: p.projectId,
      projectName: p.projectName,
      billableSessions: p.billableSessions,
      totalHours,
      hourlyRate: p.hourlyRate,
      subtotal,
    };
  });

  return {
    projects: projectsData,
    dateRange,
    customization,
    template,
  };
}
