import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppLayout } from "./AppLayout";
import { getHomeSteps } from "../../constants/homeSteps";
import { getMainNavGroups } from "../../constants/navigation";
import { TRANSLATIONS } from "../../i18n/translations";

describe("AppLayout", () => {
  it("renders sidebar navigation and matches snapshot", () => {
    const steps = getHomeSteps("fr");
    const groups = getMainNavGroups("fr");

    const { container } = render(
      <MemoryRouter>
        <AppLayout
          groups={groups}
          copy={TRANSLATIONS.fr}
          steps={steps}
          activeStepId={steps[0].id}
          completedSteps={[steps[0].id]}
          onStepAction={() => undefined}
          onQuickAction={() => undefined}
          theme="light"
          onToggleTheme={() => undefined}
          language="fr"
          onLanguageChange={() => undefined}
          isSidebarOpen={false}
          onSidebarToggle={() => undefined}
          onSidebarClose={() => undefined}
        >
          <div>Content</div>
        </AppLayout>
      </MemoryRouter>
    );

    expect(container).toMatchSnapshot();
  });
});
