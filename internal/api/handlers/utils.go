package handlers

import (
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// JSONTime is a custom type for handling multiple date formats in JSON
type JSONTime struct {
	time.Time
}

// UnmarshalJSON implements the json.Unmarshaler interface
func (jt *JSONTime) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), "\"")
	if s == "null" || s == "" {
		return nil
	}

	// Try RFC3339 (ISO 8601)
	t, err := time.Parse(time.RFC3339, s)
	if err == nil {
		jt.Time = t
		return nil
	}

	// Try YYYY-MM-DD
	t, err = time.Parse("2006-01-02", s)
	if err == nil {
		jt.Time = t
		return nil
	}

	return err
}

// Value implements the driver.Valuer interface
func (jt JSONTime) Value() (driver.Value, error) {
	if jt.IsZero() {
		return nil, nil
	}
	return jt.Time, nil
}

// RespondWithError envia uma resposta de erro em formato JSON
func RespondWithError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"message": message})
}

// RespondWithJSON envia uma resposta de sucesso em formato JSON
func RespondWithJSON(w http.ResponseWriter, code int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(payload)
}
