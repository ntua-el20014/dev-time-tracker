import { ipcRenderer } from "electron";
import jsPDF from "jspdf";
import { showNotification, showInAppNotification } from "../components";
import { safeIpcInvoke } from "./ipcHelpers";
import {
  getOrgAnalyticsSummary,
  getOrgLanguageBreakdown,
  getOrgMemberActivity,
  getOrgTopProjects,
} from "./analyticsApi";
import type {
  LanguageBreakdown,
  MemberActivity,
  OrgAnalyticsSummary,
  TopProject,
} from "../../src/supabase/orgAnalytics";

export interface OrgReportFilters {
  startDate: string;
  endDate: string;
  projectIds: string[] | null;
  memberIds: string[] | null;
  billableOnly: boolean;
}

type OrgInfo = {
  id: string;
  name?: string | null;
};

type OrgReportData = {
  orgName: string;
  filters: OrgReportFilters;
  summary: OrgAnalyticsSummary;
  topProjects: TopProject[];
  languages: LanguageBreakdown[];
  members: MemberActivity[];
};

export async function exportOrgAnalyticsReport(
  filters: OrgReportFilters,
): Promise<void> {
  try {
    const org = await safeIpcInvoke<OrgInfo | null>("org:get-current", [], {
      fallback: null,
      showNotification: false,
    });

    if (!org) {
      showNotification("Unable to load the current organization.");
      return;
    }

    const [summary, topProjects, languages, members] = await Promise.all([
      getOrgAnalyticsSummary(
        filters.startDate,
        filters.endDate,
        filters.billableOnly,
      ),
      getOrgTopProjects(
        filters.startDate,
        filters.endDate,
        filters.projectIds || undefined,
        filters.billableOnly,
        8,
      ),
      getOrgLanguageBreakdown(
        filters.startDate,
        filters.endDate,
        filters.projectIds || undefined,
        filters.memberIds || undefined,
        filters.billableOnly,
      ),
      getOrgMemberActivity(
        filters.startDate,
        filters.endDate,
        filters.projectIds || undefined,
        filters.memberIds || undefined,
        filters.billableOnly,
      ),
    ]);

    const orgName = org.name?.trim() || "Organization";
    const reportData: OrgReportData = {
      orgName,
      filters,
      summary: summary || {
        total_hours_tracked: 0,
        total_sessions: 0,
        active_members: 0,
      },
      topProjects,
      languages,
      members,
    };

    const { filePath } = await ipcRenderer.invoke("show-save-dialog", {
      title: "Export Organization Report as PDF",
      defaultPath: buildDefaultReportName(orgName, filters),
      filters: [{ name: "PDF File", extensions: ["pdf"] }],
    });

    if (!filePath) return;

    const doc = buildOrganizationReportPDF(reportData);
    doc.save(filePath);
    showInAppNotification("Organization report exported successfully!");
  } catch {
    showNotification("Export failed. Please try again.");
  }
}

function buildDefaultReportName(
  orgName: string,
  filters: OrgReportFilters,
): string {
  const slug =
    orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "organization";
  return `dev-tracker-${slug}-report-${filters.startDate}-to-${filters.endDate}.pdf`;
}

function buildOrganizationReportPDF(reportData: OrgReportData): jsPDF {
  const doc = new jsPDF({ orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  const ensureSpace = (space: number) => {
    if (y + space > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const formatHours = (hours: number) => `${hours.toFixed(1)}h`;

  const addSectionTitle = (title: string) => {
    ensureSpace(12);
    doc.setFontSize(14);
    doc.setTextColor(43, 43, 60);
    doc.text(title, margin, y);
    y += 6;
  };

  const drawStat = (x: number, label: string, value: string) => {
    doc.setFillColor(245, 247, 250);
    doc.setDrawColor(220, 224, 230);
    doc.roundedRect(x, y, 60, 18, 3, 3, "FD");
    doc.setTextColor(90, 90, 90);
    doc.setFontSize(9);
    doc.text(label, x + 4, y + 6);
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(14);
    doc.text(value, x + 4, y + 13);
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  doc.setFillColor(43, 43, 60);
  doc.rect(0, 0, pageWidth, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text("Organization Analytics Report", margin, 18);

  y = 38;
  doc.setTextColor(90, 90, 90);
  doc.setFontSize(10);
  doc.text(`${reportData.orgName} - Organization projects only`, margin, y);
  y += 7;
  doc.text(
    `Period: ${formatDate(reportData.filters.startDate)} to ${formatDate(reportData.filters.endDate)}`,
    margin,
    y,
  );
  y += 5;

  const filterNotes: string[] = [];
  if (
    reportData.filters.projectIds &&
    reportData.filters.projectIds.length > 0
  ) {
    filterNotes.push(
      `${reportData.filters.projectIds.length} selected project(s)`,
    );
  }
  if (reportData.filters.memberIds && reportData.filters.memberIds.length > 0) {
    filterNotes.push(
      `${reportData.filters.memberIds.length} selected member(s)`,
    );
  }
  if (reportData.filters.billableOnly) {
    filterNotes.push("billable sessions only");
  }
  if (filterNotes.length > 0) {
    doc.text(`Filters: ${filterNotes.join(" · ")}`, margin, y);
    y += 6;
  }

  drawStat(
    margin,
    "Hours",
    formatHours(reportData.summary.total_hours_tracked),
  );
  drawStat(margin + 66, "Sessions", String(reportData.summary.total_sessions));
  drawStat(margin + 132, "Members", String(reportData.summary.active_members));
  drawStat(margin + 198, "Projects", String(reportData.topProjects.length));
  y += 26;

  addSectionTitle("Top Projects");
  ensureSpace(14);
  doc.setFillColor(69, 69, 90);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.rect(margin - 1, y - 4, 253, 7, "F");
  doc.text("Project", margin + 2, y);
  doc.text("Hours", margin + 140, y);
  doc.text("Sessions", margin + 176, y);
  doc.text("Members", margin + 218, y);
  y += 8;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(8.5);
  if (reportData.topProjects.length === 0) {
    doc.setTextColor(110, 110, 110);
    doc.text(
      "No organization project data was found for this range.",
      margin,
      y + 6,
    );
    y += 12;
  } else {
    for (const project of reportData.topProjects) {
      ensureSpace(7);
      doc.text(project.project_name, margin + 2, y);
      doc.text(formatHours(project.total_hours), margin + 140, y);
      doc.text(String(project.session_count), margin + 176, y);
      doc.text(String(project.active_members), margin + 218, y);
      y += 6;
    }
  }

  addSectionTitle("Language Breakdown");
  if (reportData.languages.length === 0) {
    ensureSpace(8);
    doc.setTextColor(110, 110, 110);
    doc.text("No language data was found for this range.", margin, y + 4);
    y += 10;
  } else {
    for (const language of reportData.languages) {
      ensureSpace(7);
      doc.setTextColor(30, 30, 30);
      doc.text(language.language, margin + 2, y);
      doc.text(formatHours(language.total_hours), margin + 140, y);
      doc.text(`${language.percentage.toFixed(1)}%`, margin + 185, y);
      y += 6;
    }
  }

  addSectionTitle("Team Member Activity");
  ensureSpace(14);
  doc.setFillColor(69, 69, 90);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.rect(margin - 1, y - 4, 253, 7, "F");
  doc.text("Member", margin + 2, y);
  doc.text("Hours", margin + 126, y);
  doc.text("Sessions", margin + 160, y);
  doc.text("Projects", margin + 198, y);
  doc.text("Top Language", margin + 228, y);
  y += 8;

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(8.5);
  if (reportData.members.length === 0) {
    doc.setTextColor(110, 110, 110);
    doc.text(
      "No member activity data was found for this range.",
      margin,
      y + 6,
    );
  } else {
    for (const member of reportData.members) {
      ensureSpace(7);
      doc.text(member.username, margin + 2, y);
      doc.text(formatHours(member.total_hours), margin + 126, y);
      doc.text(String(member.session_count), margin + 160, y);
      doc.text(String(member.active_projects), margin + 198, y);
      doc.text(member.top_language, margin + 228, y);
      y += 6;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(130, 130, 130);
  doc.text("Generated by Dev Time Tracker", pageWidth / 2, pageHeight - 8, {
    align: "center",
  });

  return doc;
}
