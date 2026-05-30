ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS public_amenities JSONB NOT NULL DEFAULT '{
    "wifi": true,
    "payments": {
      "mb_way": true,
      "multibanco": true,
      "card": false,
      "cash": true,
      "other": ""
    },
    "parking": {
      "available": false,
      "type": "none",
      "easy_access": false
    },
    "comforts": {
      "air_conditioning": true,
      "coffee": false,
      "children": false,
      "accessibility": false,
      "tv": false,
      "water": true,
      "other": ""
    }
  }'::jsonb;
