package storage

import (
	"context"

	"github.com/google/uuid"
)

// CreateList creates a new list
func (s *Storage) CreateList(ctx context.Context, list *List) error {
	return s.DB.WithContext(ctx).Create(list).Error
}

// GetLists retrieves all lists for a user
func (s *Storage) GetLists(ctx context.Context, userID uuid.UUID) ([]List, error) {
	var lists []List
	if err := s.DB.WithContext(ctx).Where("user_id = ?", userID).Find(&lists).Error; err != nil {
		return nil, err
	}
	return lists, nil
}

// GetList retrieves a list by ID
func (s *Storage) GetList(ctx context.Context, id uuid.UUID) (*List, error) {
	var list List
	if err := s.DB.WithContext(ctx).First(&list, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &list, nil
}

// UpdateList updates a list
func (s *Storage) UpdateList(ctx context.Context, list *List) error {
	return s.DB.WithContext(ctx).Save(list).Error
}

// DeleteList deletes a list (soft delete)
func (s *Storage) DeleteList(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Delete(&List{}, id).Error
}

// CreateListItem creates a new list item
func (s *Storage) CreateListItem(ctx context.Context, item *ListItem) error {
	return s.DB.WithContext(ctx).Create(item).Error
}

// GetListItems retrieves all items for a list
func (s *Storage) GetListItems(ctx context.Context, listID uuid.UUID) ([]ListItem, error) {
	var items []ListItem
	if err := s.DB.WithContext(ctx).Where("list_id = ?", listID).Order("created_at DESC").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

// GetListItem retrieves a list item by ID
func (s *Storage) GetListItem(ctx context.Context, id uuid.UUID) (*ListItem, error) {
	var item ListItem
	if err := s.DB.WithContext(ctx).First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

// UpdateListItem updates a list item
func (s *Storage) UpdateListItem(ctx context.Context, item *ListItem) error {
	return s.DB.WithContext(ctx).Save(item).Error
}

// DeleteListItem deletes a list item (soft delete)
func (s *Storage) DeleteListItem(ctx context.Context, id uuid.UUID) error {
	return s.DB.WithContext(ctx).Delete(&ListItem{}, id).Error
}

// DeleteListItemsByListID deletes all items for a list (e.g. when deleting the list)
func (s *Storage) DeleteListItemsByListID(ctx context.Context, listID uuid.UUID) error {
	return s.DB.WithContext(ctx).Where("list_id = ?", listID).Delete(&ListItem{}).Error
}
