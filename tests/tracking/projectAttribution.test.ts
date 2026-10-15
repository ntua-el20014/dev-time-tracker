import { describe, it, expect } from "vitest";
import { ProjectAttribution } from "../../src/tracking/projectAttribution";
import type { RepoInfo } from "../../src/tracking/repoResolver";

const repo = (name: string): RepoInfo => ({
  key: `github.com/acme/${name}`,
  name,
  root: `C:\\code\\${name}`,
});
const shop = repo("shop");
const blog = repo("blog");

function linked() {
  const a = new ProjectAttribution();
  a.setLinks([{ repo_key: shop.key, project_id: "p-shop" }]);
  return a;
}

describe("ProjectAttribution", () => {
  it("keeps the last repo while a non-dev window is focused", () => {
    const a = linked();
    expect(a.observe(shop)).toBe(true);
    expect(a.observe(null)).toBe(false);
    expect(a.currentRepo()).toBe(shop);
    expect(a.observe(shop)).toBe(false);
    expect(a.observe(blog)).toBe(true);
  });

  it("describes the detected repo with its linked project", () => {
    const a = linked();
    expect(a.describe()).toBeNull();
    a.observe(shop);
    expect(a.describe()).toEqual({ key: shop.key, name: "shop", projectId: "p-shop" });
    a.observe(blog);
    expect(a.describe()?.projectId).toBeNull();
    a.setLink(blog.key, "p-blog");
    expect(a.describe()?.projectId).toBe("p-blog");
    a.setLink(blog.key, null);
    expect(a.describe()?.projectId).toBeNull();
  });

  it("counts session time only while the repo is focused", () => {
    const a = linked();
    a.observe(shop);
    a.addSessionTime(5);
    a.observe(null); // browser
    a.addSessionTime(5);
    a.observe(blog);
    a.addSessionTime(5);
    a.observe(shop);
    a.addSessionTime(5);
    expect(a.dominantRepo()).toBe(shop);
    a.resetSession();
    expect(a.dominantRepo()).toBeNull();
  });

  describe("projectToSelect (before Start)", () => {
    it("switches an automatic choice to the repo's linked project", () => {
      const a = linked();
      a.observe(shop);
      expect(a.projectToSelect({ isRecording: false, source: "auto", selected: null })).toBe("p-shop");
      expect(a.projectToSelect({ isRecording: false, source: "auto", selected: "other" })).toBe("p-shop");
    });

    it("never overrides a manual pick or a running session", () => {
      const a = linked();
      a.observe(shop);
      expect(a.projectToSelect({ isRecording: false, source: "manual", selected: "other" })).toBeNull();
      expect(a.projectToSelect({ isRecording: true, source: "auto", selected: "other" })).toBeNull();
    });

    it("does nothing for unlinked repos or when already selected", () => {
      const a = linked();
      expect(a.projectToSelect({ isRecording: false, source: "auto", selected: null })).toBeNull();
      a.observe(blog);
      expect(a.projectToSelect({ isRecording: false, source: "auto", selected: null })).toBeNull();
      a.observe(shop);
      expect(a.projectToSelect({ isRecording: false, source: "auto", selected: "p-shop" })).toBeNull();
    });
  });

  describe("projectForStoppedSession", () => {
    it("keeps the user's pick", () => {
      const a = linked();
      a.observe(shop);
      a.addSessionTime(60);
      expect(a.projectForStoppedSession("mine", "manual")).toBe("mine");
      expect(a.projectForStoppedSession(null, "manual")).toBeNull();
    });

    it("otherwise uses the link of the repo worked in longest", () => {
      const a = linked();
      a.observe(blog);
      a.addSessionTime(10);
      a.observe(shop);
      a.addSessionTime(60);
      expect(a.projectForStoppedSession("restored", "auto")).toBe("p-shop");
    });

    it("falls back to the selection when the main repo isn't linked", () => {
      const a = linked();
      a.observe(blog);
      a.addSessionTime(60);
      expect(a.projectForStoppedSession("restored", "auto")).toBe("restored");
    });
  });

  it("reset forgets links, repo and session time", () => {
    const a = linked();
    a.observe(shop);
    a.addSessionTime(5);
    a.reset();
    expect(a.currentRepo()).toBeNull();
    expect(a.dominantRepo()).toBeNull();
    expect(a.projectFor(shop.key)).toBeNull();
  });
});
