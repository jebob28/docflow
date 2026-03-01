package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/opensearch-project/opensearch-go/v2"
	"github.com/opensearch-project/opensearch-go/v2/opensearchapi"
)

type OpenSearchService struct {
	client *opensearch.Client
}

type DocumentIndex struct {
	ID        string    `json:"id"`
	TenantID  uuid.UUID `json:"tenant_id"`
	Name      string    `json:"name"`
	OCRText   string    `json:"ocr_text"`
	Extension string    `json:"extension"`
	SectorID  *uuid.UUID `json:"sector_id"`
	UpdatedAt string    `json:"updated_at"`
}

func NewOpenSearchService() *OpenSearchService {
	address := os.Getenv("OPENSEARCH_URL")
	if address == "" {
		address = "http://localhost:9200"
	}

	cfg := opensearch.Config{
		Addresses: []string{address},
	}

	client, err := opensearch.NewClient(cfg)
	if err != nil {
		log.Printf("Erro ao criar cliente OpenSearch: %v", err)
		return nil
	}

	s := &OpenSearchService{client: client}
	s.EnsureIndex(context.Background())
	return s
}

func (s *OpenSearchService) EnsureIndex(ctx context.Context) {
	if s.client == nil {
		return
	}

	indexName := "documents"
	existsReq := opensearchapi.IndicesExistsRequest{
		Index: []string{indexName},
	}
	res, err := existsReq.Do(ctx, s.client)
	if err != nil {
		log.Printf("Erro ao verificar existência do índice OpenSearch: %v", err)
		return
	}
	defer res.Body.Close()

	if res.StatusCode == 404 {
		// Criar índice com mapping
		mapping := `{
			"settings": {
				"index": {
					"number_of_shards": 1,
					"number_of_replicas": 0
				}
			},
			"mappings": {
				"properties": {
					"id": { "type": "keyword" },
					"tenant_id": { "type": "keyword" },
					"name": { "type": "text", "analyzer": "brazilian" },
					"ocr_text": { "type": "text", "analyzer": "brazilian" },
					"extension": { "type": "keyword" },
					"sector_id": { "type": "keyword" },
					"updated_at": { "type": "date" }
				}
			}
		}`

		createReq := opensearchapi.IndicesCreateRequest{
			Index: indexName,
			Body:  strings.NewReader(mapping),
		}
		res, err := createReq.Do(ctx, s.client)
		if err != nil {
			log.Printf("Erro ao criar índice OpenSearch: %v", err)
			return
		}
		defer res.Body.Close()
		log.Printf("Índice OpenSearch 'documents' criado com sucesso")
	}
}

func (s *OpenSearchService) IndexDocument(ctx context.Context, doc DocumentIndex) error {
	if s.client == nil {
		return nil
	}

	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}

	req := opensearchapi.IndexRequest{
		Index:      "documents",
		DocumentID: doc.ID,
		Body:       strings.NewReader(string(data)),
		Refresh:    "true",
	}

	res, err := req.Do(ctx, s.client)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.IsError() {
		return fmt.Errorf("erro ao indexar documento: %s", res.Status())
	}

	return nil
}

func (s *OpenSearchService) Search(ctx context.Context, tenantID uuid.UUID, query string, sectorIDs []uuid.UUID) ([]string, error) {
	if s.client == nil {
		return nil, nil
	}

	// Construir query de busca
	// Filtra por tenant_id e opcionalmente por sector_id
	// Busca o termo no ocr_text e no name
	
	var sectorFilter string
	if len(sectorIDs) > 0 {
		var sids []string
		for _, id := range sectorIDs {
			sids = append(sids, fmt.Sprintf("\"%s\"", id.String()))
		}
		sectorFilter = fmt.Sprintf(`,
			{ "terms": { "sector_id": [%s] } }`, strings.Join(sids, ","))
	}

	// Usamos uma query bool com must para tenant_id e multi_match para o texto.
	// O multi_match com cross_fields e operator AND ajuda a encontrar termos espalhados.
	searchQuery := fmt.Sprintf(`{
		"query": {
			"bool": {
				"must": [
					{ "multi_match": {
						"query": "%s",
						"fields": ["name^3", "ocr_text"],
						"type": "best_fields",
						"operator": "and"
					} }
				],
				"filter": [
					{ "term": { "tenant_id": "%s" } }%s
				]
			}
		}
	}`, query, tenantID.String(), sectorFilter)

	log.Printf("[DEBUG] Query OpenSearch: %s", searchQuery)

	req := opensearchapi.SearchRequest{
		Index: []string{"documents"},
		Body:  strings.NewReader(searchQuery),
	}

	res, err := req.Do(ctx, s.client)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.IsError() {
		return nil, fmt.Errorf("erro na busca OpenSearch: %s", res.Status())
	}

	var r map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil {
		return nil, err
	}

	var ids []string
	if hits, ok := r["hits"].(map[string]interface{}); ok {
		if hitsList, ok := hits["hits"].([]interface{}); ok {
			for _, hit := range hitsList {
				if h, ok := hit.(map[string]interface{}); ok {
					if id, ok := h["_id"].(string); ok {
						ids = append(ids, id)
					}
				}
			}
		}
	}

	return ids, nil
}
