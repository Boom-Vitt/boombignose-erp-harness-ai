# fix-locale-overflow
Symptom: toggle label flips but UI text stays. Root cause: only reports used <Bi>; sidebar hard-coded TH+EN; Bi relied on CSS group under display:contents.
Acceptance: toggle switches sidebar/nav + all Bi; html lang follows; cards wrap/truncate long text.
