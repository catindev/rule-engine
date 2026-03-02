const path = require("path");
const engine = require("../index");

const rulesDir = path.join(__dirname, "..", "rules");
const { compiled } = engine.loadAndCompile(rulesDir);

const good = {
  beneficiary: {
    type: "UL_RESIDENT",
    jurisdiction: "RU",
    isPassiveNFE: "N",
    hasForeignControllingPersons: "N",
    isUSPerson: "N",
    hasUSControllingPersons: "N"
  },
  ul: {
    inn: "7707083893",
    nameFullRu: "ООО Ромашка",
    opf: "ООО",
    ogrn: "1027700132195",
    address: { full: "Москва, ул. Пушкина, д. 1" }
  },
  agreement: {
    basisId: "BASIS-123",
    statusStartDate: "2026-03-01"
  },
  contacts: { email: "test@example.com" },
  tax: { isForeignTaxResident: "N" }
};

const bad = {
  beneficiary: {
    type: "UL_RESIDENT",
    jurisdiction: "RU",
    isPassiveNFE: "Y",
    hasForeignControllingPersons: "N",
    isUSPerson: "N",
    hasUSControllingPersons: "N"
  },
  ul: {
    inn: "0000000000",
    nameFullRu: "",
    opf: "",
    ogrn: "0000000000000",
    address: { full: "" }
  },
  agreement: {
    basisId: "",
    statusStartDate: "2026-03-xx",
    statusEndDate: "2026-02-01"
  },
  contacts: { },
  tax: { isForeignTaxResident: "Y", country: "", tin: "", foreignAddress: { full: "" } }
};

const missingType = {
  beneficiary: {
    jurisdiction: "RU",
    isPassiveNFE: "N",
    hasForeignControllingPersons: "N",
    isUSPerson: "N",
    hasUSControllingPersons: "N"
  }
};

console.log("\n--- RUN GOOD ---");
console.dir(engine.runPipeline(compiled, "pipeline_main", good), { depth: null });

console.log("\n--- RUN BAD (many errors) ---");
console.dir(engine.runPipeline(compiled, "pipeline_main", bad), { depth: null });

console.log("\n--- RUN MISSING TYPE (EXCEPTION stop) ---");
console.dir(engine.runPipeline(compiled, "pipeline_main", missingType), { depth: null });
