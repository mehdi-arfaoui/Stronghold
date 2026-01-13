rule credit_card {
  strings:
    $cc = /(?:\d[ -]*?){13,19}/
  condition:
    $cc
}

rule iban {
  strings:
    $iban = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/
  condition:
    $iban
}

rule email {
  strings:
    $email = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ nocase
  condition:
    $email
}

rule phone {
  strings:
    $phone = /\b\+?[0-9][0-9\s().-]{7,}[0-9]\b/
  condition:
    $phone
}

rule national_id {
  strings:
    $nid = /\b\d{13}\b/
  condition:
    $nid
}

rule passport {
  strings:
    $pass = /\b(?:passport|passeport)\b/ nocase
  condition:
    $pass
}

rule pii_keywords {
  strings:
    $pii1 = /\b(nom|pr[ée]nom|social security|ssn|national id|num[ée]ro de s[ée]curit[ée] sociale|pii)\b/ nocase
  condition:
    any of them
}
